using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using System.Web.Script.Serialization;
using Microsoft.Win32.SafeHandles;

// Trusted broker: no shell, script evaluation or model-chosen executable is accepted.
// Each run changes one path of the granted folder: write a file, create a folder, move a file, delete a file or remove
// an empty folder. Every step opens what it changes without following reparse points, checks it is the file or folder
// it expects, and changes it through that same handle, so what was checked is what is changed.
internal static class WorkspaceIntegrate
{
    private const uint ReadAttributes = 0x80;
    private const uint GenericRead = 0x80000000;
    private const uint GenericReadWrite = 0xC0000000;
    private const uint DeleteAccess = 0x00010000;
    private const uint ShareRead = 1;
    private const uint ShareWrite = 2;
    private const uint CreateNew = 1;
    private const uint OpenExisting = 3;
    private const uint OpenReparsePoint = 0x00200000;
    private const uint BackupSemantics = 0x02000000;
    private const uint WriteThrough = 0x80000000;
    private const uint DirectoryAttribute = 0x10;
    private const uint ReparsePoint = 0x400;
    private const int FileRenameInformation = 3;
    private const int FileDispositionInformation = 4;
    private const int ErrorFileNotFound = 2;
    private const int ErrorPathNotFound = 3;
    private const int ErrorFileExists = 80;
    private const int ErrorDirectoryNotEmpty = 145;
    private const int ErrorAlreadyExists = 183;
    private const int MaximumBytes = 1024 * 1024;
    private static bool MayHaveChanged;

    [StructLayout(LayoutKind.Sequential)]
    private struct FileInformation
    {
        public uint Attributes;
        public System.Runtime.InteropServices.ComTypes.FILETIME Creation;
        public System.Runtime.InteropServices.ComTypes.FILETIME Access;
        public System.Runtime.InteropServices.ComTypes.FILETIME Write;
        public uint Volume;
        public uint SizeHigh;
        public uint SizeLow;
        public uint Links;
        public uint IndexHigh;
        public uint IndexLow;
    }

    /// <summary>The person's folder changed at this path since the snapshot; nothing was changed by this step.</summary>
    private sealed class ConflictException : Exception
    {
        public readonly string Reason;
        public readonly string CurrentHash;
        public ConflictException(string reason, string currentHash) : base(reason)
        {
            Reason = reason;
            CurrentHash = currentHash;
        }
    }

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern SafeFileHandle CreateFile(string path, uint access, uint share, IntPtr security, uint disposition, uint flags, IntPtr template);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern uint GetFinalPathNameByHandle(SafeFileHandle handle, StringBuilder path, uint size, uint flags);
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool GetFileInformationByHandle(SafeFileHandle handle, out FileInformation information);
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool SetFileInformationByHandle(SafeFileHandle handle, int informationClass, byte[] information, uint size);

    private static FileInformation Inspect(SafeFileHandle handle)
    {
        FileInformation information;
        if (handle.IsInvalid || !GetFileInformationByHandle(handle, out information)) throw new Win32Exception(Marshal.GetLastWin32Error());
        if ((information.Attributes & ReparsePoint) != 0) throw new InvalidOperationException("reparse_point");
        return information;
    }

    private static string FinalPath(SafeFileHandle handle)
    {
        var path = new StringBuilder(32768);
        uint length = GetFinalPathNameByHandle(handle, path, (uint)path.Capacity, 0);
        if (length == 0 || length >= path.Capacity) throw new InvalidOperationException("invalid_final_path");
        string value = path.ToString();
        if (value.StartsWith(@"\\?\")) value = value.Substring(4);
        return value.TrimEnd('\\');
    }

    private static bool SamePath(string first, string second)
    {
        return String.Equals(first.TrimEnd('\\'), second.TrimEnd('\\'), StringComparison.OrdinalIgnoreCase);
    }

    private static string Hash(byte[] bytes)
    {
        using (var hash = SHA256.Create()) return BitConverter.ToString(hash.ComputeHash(bytes)).Replace("-", "").ToLowerInvariant();
    }

    private static bool IsMissing(int error)
    {
        return error == ErrorFileNotFound || error == ErrorPathNotFound;
    }

    private static SafeFileHandle LockDirectory(string path, string expected)
    {
        // Deny write/delete sharing to keep the directory from becoming a junction or being renamed.
        var handle = CreateFile(path, ReadAttributes, ShareRead, IntPtr.Zero, OpenExisting, BackupSemantics | OpenReparsePoint, IntPtr.Zero);
        try
        {
            var information = Inspect(handle);
            if ((information.Attributes & DirectoryAttribute) == 0 || !SamePath(FinalPath(handle), expected))
                throw new InvalidOperationException("directory_changed");
            return handle;
        }
        catch { handle.Dispose(); throw; }
    }

    private static string[] ValidatedParts(string relativePath)
    {
        if (relativePath == null || relativePath.Length == 0 || relativePath.Length > 240 || Regex.IsMatch(relativePath, @"[\\:<>|?*\x00-\x1f]"))
            throw new InvalidOperationException("invalid_request");
        string[] parts = relativePath.Split('/');
        foreach (string part in parts)
        {
            if (part.Length == 0 || part == "." || part == ".." || part.EndsWith(".") || part.EndsWith(" ")
                || part.Equals(".git", StringComparison.OrdinalIgnoreCase) || part.StartsWith(".orglet-", StringComparison.OrdinalIgnoreCase)
                || Regex.IsMatch(part, @"^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)", RegexOptions.IgnoreCase))
                throw new InvalidOperationException("invalid_request");
        }
        return parts;
    }

    private static string ValidatedHash(IDictionary<string, object> request, bool required)
    {
        object value;
        string hash = request.TryGetValue("expectedHash", out value) ? value as string : null;
        if (hash == null && !required) return null;
        if (hash == null || !Regex.IsMatch(hash, "^[a-f0-9]{64}$")) throw new InvalidOperationException("invalid_request");
        return hash;
    }

    /// <summary>
    /// Locks every folder from the root down to the parent of the last part and returns that parent's path. With
    /// create, missing folders are made on the way (a new file's or a moved file's parents); without it, a missing
    /// folder means the person removed it, which is a conflict.
    /// </summary>
    private static string LockParents(string root, string[] parts, int count, bool create, List<SafeFileHandle> locks)
    {
        string parent = root;
        for (int index = 0; index < count; index++)
        {
            parent = Path.Combine(parent, parts[index]);
            if (create && !Directory.Exists(parent) && !File.Exists(parent)) Directory.CreateDirectory(parent);
            try
            {
                locks.Add(LockDirectory(parent, parent));
            }
            catch (Win32Exception error)
            {
                if (!create && IsMissing(error.NativeErrorCode)) throw new ConflictException("missing", null);
                throw;
            }
        }
        return parent;
    }

    private static byte[] ReadAll(FileStream file)
    {
        if (file.Length > MaximumBytes) throw new InvalidOperationException("file_too_large");
        byte[] bytes = new byte[(int)file.Length];
        int offset = 0;
        while (offset < bytes.Length)
        {
            int count = file.Read(bytes, offset, bytes.Length - offset);
            if (count == 0) throw new EndOfStreamException();
            offset += count;
        }
        return bytes;
    }

    /// <summary>Opens an existing plain file exclusively, refusing links, folders and a path that resolves elsewhere.</summary>
    private static SafeFileHandle OpenExistingFile(string target, uint access, uint flags)
    {
        var handle = CreateFile(target, access, 0, IntPtr.Zero, OpenExisting, OpenReparsePoint | flags, IntPtr.Zero);
        if (handle.IsInvalid)
        {
            int error = Marshal.GetLastWin32Error();
            handle.Dispose();
            if (IsMissing(error)) throw new ConflictException("missing", null);
            throw new Win32Exception(error);
        }
        try
        {
            var information = Inspect(handle);
            if (information.Links != 1 || (information.Attributes & DirectoryAttribute) != 0 || !SamePath(FinalPath(handle), target))
                throw new InvalidOperationException("unsafe_target");
            return handle;
        }
        catch { handle.Dispose(); throw; }
    }

    private static void WriteBackup(string backupPath, byte[] original)
    {
        using (var backup = new FileStream(backupPath, FileMode.CreateNew, FileAccess.Write, FileShare.None))
        {
            backup.Write(original, 0, original.Length);
            backup.Flush(true);
        }
    }

    private static object Write(string root, string[] parts, IDictionary<string, object> request)
    {
        string expectedHash = ValidatedHash(request, false);
        string backupPath = Path.GetFullPath((string)request["backupPath"]);
        byte[] replacement = Convert.FromBase64String((string)request["contentBase64"]);
        if (replacement.Length > MaximumBytes) throw new InvalidOperationException("invalid_request");
        var locks = new List<SafeFileHandle>();
        try
        {
            locks.Add(LockDirectory(root, root));
            string parent = LockParents(root, parts, parts.Length - 1, expectedHash == null, locks);
            string target = Path.Combine(parent, parts[parts.Length - 1]);
            var handle = CreateFile(target, GenericReadWrite, 0, IntPtr.Zero, expectedHash == null ? CreateNew : OpenExisting,
                OpenReparsePoint | WriteThrough, IntPtr.Zero);
            if (handle.IsInvalid)
            {
                int error = Marshal.GetLastWin32Error();
                handle.Dispose();
                // A file the person created at a new path, or removed from an edited one, is theirs to keep.
                if (expectedHash == null && (error == ErrorFileExists || error == ErrorAlreadyExists)) throw new ConflictException("exists", null);
                if (expectedHash != null && IsMissing(error)) throw new ConflictException("missing", null);
                throw new Win32Exception(error);
            }
            using (handle)
            {
                if (expectedHash == null) MayHaveChanged = true;
                var information = Inspect(handle);
                if (information.Links != 1 || (information.Attributes & DirectoryAttribute) != 0 || !SamePath(FinalPath(handle), target))
                    throw new InvalidOperationException("unsafe_target");
                using (var file = new FileStream(handle, FileAccess.ReadWrite))
                {
                    byte[] original = ReadAll(file);
                    if (expectedHash != null && Hash(original) != expectedHash) throw new ConflictException("changed", Hash(original));
                    // A flushed backup exists before the first byte of an existing file changes.
                    WriteBackup(backupPath, original);
#if WORKSPACE_TESTING
                    PauseForCrashTest(request, "after_backup");
#endif
                    try
                    {
                        MayHaveChanged = true;
                        file.Position = 0;
                        file.Write(replacement, 0, replacement.Length);
                        file.SetLength(replacement.Length);
                        file.Flush(true);
#if WORKSPACE_TESTING
                        PauseForCrashTest(request, "after_write");
#endif
                    }
                    catch
                    {
                        file.Position = 0;
                        file.Write(original, 0, original.Length);
                        file.SetLength(original.Length);
                        file.Flush(true);
                        MayHaveChanged = expectedHash == null;
                        throw;
                    }
                    return new { status = "applied", hash = Hash(replacement) };
                }
            }
        }
        finally
        {
            Release(locks);
        }
    }

    /// <summary>Creates a folder and its missing parents; one already there, as a folder, is left alone.</summary>
    private static object CreateFolder(string root, string[] parts)
    {
        var locks = new List<SafeFileHandle>();
        try
        {
            locks.Add(LockDirectory(root, root));
            string parent = LockParents(root, parts, parts.Length - 1, true, locks);
            string target = Path.Combine(parent, parts[parts.Length - 1]);
            if (File.Exists(target)) throw new ConflictException("exists", null);
            if (!Directory.Exists(target))
            {
                MayHaveChanged = true;
                Directory.CreateDirectory(target);
            }
            using (LockDirectory(target, target)) return new { status = "applied", hash = (string)null };
        }
        finally
        {
            Release(locks);
        }
    }

    /// <summary>
    /// Renames a file whose bytes still match the snapshot to a free path, through the handle it was hashed with. A
    /// rename never replaces: a file the person put at the new path is a conflict. Letter case alone may change.
    /// </summary>
    private static object Move(string root, string[] fromParts, string[] parts, IDictionary<string, object> request)
    {
        string expectedHash = ValidatedHash(request, true);
        var locks = new List<SafeFileHandle>();
        try
        {
            locks.Add(LockDirectory(root, root));
            string sourceParent = LockParents(root, fromParts, fromParts.Length - 1, false, locks);
            string source = Path.Combine(sourceParent, fromParts[fromParts.Length - 1]);
            using (var handle = OpenExistingFile(source, GenericRead | DeleteAccess, 0))
            {
                using (var file = new FileStream(handle, FileAccess.Read))
                {
                    byte[] original = ReadAll(file);
                    if (Hash(original) != expectedHash) throw new ConflictException("changed", Hash(original));
                    var targetLocks = new List<SafeFileHandle>();
                    try
                    {
                        string targetParent = LockParents(root, parts, parts.Length - 1, true, targetLocks);
                        string target = Path.Combine(targetParent, parts[parts.Length - 1]);
                        bool caseOnly = SamePath(source, target);
                        if (!caseOnly && (File.Exists(target) || Directory.Exists(target))) throw new ConflictException("exists", null);
#if WORKSPACE_TESTING
                        PauseForCrashTest(request, "before_rename");
#endif
                        MayHaveChanged = true;
                        if (!Rename(handle, target))
                        {
                            int error = Marshal.GetLastWin32Error();
                            MayHaveChanged = false;
                            if (error == ErrorAlreadyExists || error == ErrorFileExists) throw new ConflictException("exists", null);
                            throw new Win32Exception(error);
                        }
                        if (!SamePath(FinalPath(handle), target)) throw new InvalidOperationException("moved_elsewhere");
                        return new { status = "applied", hash = expectedHash };
                    }
                    finally
                    {
                        Release(targetLocks);
                    }
                }
            }
        }
        finally
        {
            Release(locks);
        }
    }

    private static bool Rename(SafeFileHandle handle, string target)
    {
        // FILE_RENAME_INFO on x64: ReplaceIfExists (padded to 8), RootDirectory (8), FileNameLength (4), FileName.
        byte[] name = Encoding.Unicode.GetBytes(target);
        byte[] information = new byte[20 + name.Length + 2];
        BitConverter.GetBytes(name.Length).CopyTo(information, 16);
        name.CopyTo(information, 20);
        return SetFileInformationByHandle(handle, FileRenameInformation, information, (uint)information.Length);
    }

    private static bool MarkForDeletion(SafeFileHandle handle)
    {
        return SetFileInformationByHandle(handle, FileDispositionInformation, new byte[] { 1, 0, 0, 0 }, 4);
    }

    /// <summary>
    /// Deletes a file whose bytes still match the snapshot. Its bytes are flushed to the private backup first, and the
    /// file removed is the handle that was hashed, so an edit the person made meanwhile can never be deleted.
    /// </summary>
    private static object Delete(string root, string[] parts, IDictionary<string, object> request)
    {
        string expectedHash = ValidatedHash(request, true);
        string backupPath = Path.GetFullPath((string)request["backupPath"]);
        var locks = new List<SafeFileHandle>();
        try
        {
            locks.Add(LockDirectory(root, root));
            string parent = LockParents(root, parts, parts.Length - 1, false, locks);
            string target = Path.Combine(parent, parts[parts.Length - 1]);
            using (var handle = OpenExistingFile(target, GenericRead | DeleteAccess, 0))
            {
                using (var file = new FileStream(handle, FileAccess.Read))
                {
                    byte[] original = ReadAll(file);
                    if (Hash(original) != expectedHash) throw new ConflictException("changed", Hash(original));
                    WriteBackup(backupPath, original);
#if WORKSPACE_TESTING
                    PauseForCrashTest(request, "after_backup");
#endif
                    MayHaveChanged = true;
                    if (!MarkForDeletion(handle))
                    {
                        int error = Marshal.GetLastWin32Error();
                        MayHaveChanged = false;
                        throw new Win32Exception(error);
                    }
                    return new { status = "applied", hash = (string)null };
                }
            }
        }
        finally
        {
            Release(locks);
        }
    }

    /// <summary>Removes a folder only while it is empty; anything the person put in it meanwhile keeps it.</summary>
    private static object RemoveFolder(string root, string[] parts)
    {
        var locks = new List<SafeFileHandle>();
        try
        {
            locks.Add(LockDirectory(root, root));
            string parent = LockParents(root, parts, parts.Length - 1, false, locks);
            string target = Path.Combine(parent, parts[parts.Length - 1]);
            // Explorer keeps a watched folder open for listing, so reading stays shared; nobody else may rename or delete
            // it while it is held. The file system checks emptiness when the deletion is marked, and refuses new
            // entries in a folder marked for deletion, so nothing can slip in between.
            var handle = CreateFile(target, ReadAttributes | DeleteAccess, ShareRead | ShareWrite, IntPtr.Zero, OpenExisting, BackupSemantics | OpenReparsePoint, IntPtr.Zero);
            if (handle.IsInvalid)
            {
                int error = Marshal.GetLastWin32Error();
                handle.Dispose();
                if (IsMissing(error)) throw new ConflictException("missing", null);
                throw new Win32Exception(error);
            }
            using (handle)
            {
                var information = Inspect(handle);
                if ((information.Attributes & DirectoryAttribute) == 0 || !SamePath(FinalPath(handle), target))
                    throw new InvalidOperationException("unsafe_target");
                MayHaveChanged = true;
                if (!MarkForDeletion(handle))
                {
                    int error = Marshal.GetLastWin32Error();
                    MayHaveChanged = false;
                    if (error == ErrorDirectoryNotEmpty) throw new ConflictException("not_empty", null);
                    throw new Win32Exception(error);
                }
                return new { status = "applied", hash = (string)null };
            }
        }
        finally
        {
            Release(locks);
        }
    }

    private static void Release(List<SafeFileHandle> locks)
    {
        for (int index = locks.Count - 1; index >= 0; index--) locks[index].Dispose();
    }

    private static object Apply(IDictionary<string, object> request)
    {
        object value;
        string operation = request.TryGetValue("operation", out value) ? value as string : "write";
        string root = Path.GetFullPath((string)request["root"]).TrimEnd('\\');
        if (root.Length < 3 || root.StartsWith(@"\\")) throw new InvalidOperationException("invalid_request");
        string[] parts = ValidatedParts(request["path"] as string);
        try
        {
            switch (operation)
            {
                case "write": return Write(root, parts, request);
                case "create_folder": return CreateFolder(root, parts);
                case "move": return Move(root, ValidatedParts(request["from"] as string), parts, request);
                case "delete": return Delete(root, parts, request);
                case "remove_folder": return RemoveFolder(root, parts);
                default: throw new InvalidOperationException("invalid_request");
            }
        }
        catch (ConflictException conflict)
        {
            return new { status = "conflict", hash = conflict.CurrentHash, reason = conflict.Reason };
        }
    }

    private static int Main()
    {
        Console.InputEncoding = new UTF8Encoding(false, true);
        Console.OutputEncoding = new UTF8Encoding(false);
        var serializer = new JavaScriptSerializer { MaxJsonLength = 3 * MaximumBytes };
        try
        {
            var buffer = new char[3 * MaximumBytes + 1];
            int size = 0;
            int count;
            while ((count = Console.In.Read(buffer, size, buffer.Length - size)) > 0)
            {
                size += count;
                if (size == buffer.Length) throw new InvalidOperationException("request_too_large");
            }
            var request = serializer.Deserialize<Dictionary<string, object>>(new string(buffer, 0, size));
            Console.Write(serializer.Serialize(Apply(request)));
            return 0;
        }
        catch (Exception error)
        {
            Console.Write(serializer.Serialize(new { status = MayHaveChanged ? "uncertain" : "blocked", reason = error is Win32Exception ? "file_locked_or_unavailable" : error.Message }));
            return 1;
        }
    }
#if WORKSPACE_TESTING
    private static void PauseForCrashTest(IDictionary<string, object> request, string point)
    {
        object selected;
        if (request.TryGetValue("testCrashAt", out selected) && String.Equals(selected as string, point))
        {
            Console.Error.WriteLine(point);
            Console.Error.Flush();
            System.Threading.Thread.Sleep(System.Threading.Timeout.Infinite);
        }
    }
#endif
}
