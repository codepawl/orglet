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
internal static class WorkspaceIntegrate
{
    private const uint ReadAttributes = 0x80;
    private const uint GenericReadWrite = 0xC0000000;
    private const uint OpenReparsePoint = 0x00200000;
    private const uint BackupSemantics = 0x02000000;
    private const uint WriteThrough = 0x80000000;
    private const uint ReparsePoint = 0x400;
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

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern SafeFileHandle CreateFile(string path, uint access, uint share, IntPtr security, uint disposition, uint flags, IntPtr template);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern uint GetFinalPathNameByHandle(SafeFileHandle handle, StringBuilder path, uint size, uint flags);
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool GetFileInformationByHandle(SafeFileHandle handle, out FileInformation information);

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

    private static string Hash(byte[] bytes)
    {
        using (var hash = SHA256.Create()) return BitConverter.ToString(hash.ComputeHash(bytes)).Replace("-", "").ToLowerInvariant();
    }

    private static SafeFileHandle LockDirectory(string path, string expected)
    {
        // Deny write/delete sharing to keep the directory from becoming a junction or being renamed.
        var handle = CreateFile(path, ReadAttributes, 1, IntPtr.Zero, 3, BackupSemantics | OpenReparsePoint, IntPtr.Zero);
        try
        {
            var information = Inspect(handle);
            if ((information.Attributes & 0x10) == 0 || !String.Equals(FinalPath(handle), expected.TrimEnd('\\'), StringComparison.OrdinalIgnoreCase))
                throw new InvalidOperationException("directory_changed");
            return handle;
        }
        catch { handle.Dispose(); throw; }
    }

    private static object Apply(IDictionary<string, object> request)
    {
        string root = Path.GetFullPath((string)request["root"]).TrimEnd('\\');
        string relativePath = (string)request["path"];
        string expectedHash = request["expectedHash"] as string;
        string backupPath = Path.GetFullPath((string)request["backupPath"]);
        byte[] replacement = Convert.FromBase64String((string)request["contentBase64"]);
        if (root.Length < 3 || root.StartsWith(@"\\") || replacement.Length > MaximumBytes || relativePath.Length == 0 || relativePath.Length > 240
            || Regex.IsMatch(relativePath, @"[\\:<>|?*\x00-\x1f]") || (expectedHash != null && !Regex.IsMatch(expectedHash, "^[a-f0-9]{64}$")))
            throw new InvalidOperationException("invalid_request");
        string[] parts = relativePath.Split('/');
        foreach (string part in parts)
        {
            if (part.Length == 0 || part == "." || part == ".." || part.EndsWith(".") || part.EndsWith(" ")
                || part.Equals(".git", StringComparison.OrdinalIgnoreCase) || part.StartsWith(".orglet-", StringComparison.OrdinalIgnoreCase)
                || Regex.IsMatch(part, @"^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)", RegexOptions.IgnoreCase))
                throw new InvalidOperationException("invalid_request");
        }
        var directories = new List<SafeFileHandle>();
        try
        {
            directories.Add(LockDirectory(root, root));
            string parent = root;
            for (int index = 0; index < parts.Length - 1; index++)
            {
                parent = Path.Combine(parent, parts[index]);
                if (expectedHash == null && !Directory.Exists(parent)) Directory.CreateDirectory(parent);
                directories.Add(LockDirectory(parent, parent));
            }
            string target = Path.Combine(parent, parts[parts.Length - 1]);
            var handle = CreateFile(target, GenericReadWrite, 0, IntPtr.Zero, expectedHash == null ? 1u : 3u,
                OpenReparsePoint | WriteThrough, IntPtr.Zero);
            using (handle)
            {
                if (expectedHash == null && !handle.IsInvalid) MayHaveChanged = true;
                var information = Inspect(handle);
                if (information.Links != 1 || (information.Attributes & 0x10) != 0
                    || !String.Equals(FinalPath(handle), target, StringComparison.OrdinalIgnoreCase))
                    throw new InvalidOperationException("unsafe_target");
                using (var file = new FileStream(handle, FileAccess.ReadWrite))
                {
                    if (file.Length > MaximumBytes) throw new InvalidOperationException("file_too_large");
                    byte[] original = new byte[(int)file.Length];
                    int offset = 0;
                    while (offset < original.Length)
                    {
                        int count = file.Read(original, offset, original.Length - offset);
                        if (count == 0) throw new EndOfStreamException();
                        offset += count;
                    }
                    if (expectedHash != null && Hash(original) != expectedHash)
                        return new { status = "conflict", hash = Hash(original) };
                    // A flushed backup exists before the first byte of an existing file changes.
                    using (var backup = new FileStream(backupPath, FileMode.CreateNew, FileAccess.Write, FileShare.None))
                    {
                        backup.Write(original, 0, original.Length);
                        backup.Flush(true);
                    }
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
            for (int index = directories.Count - 1; index >= 0; index--) directories[index].Dispose();
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
