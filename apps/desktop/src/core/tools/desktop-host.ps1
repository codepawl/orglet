# Orglet's desktop helper (COD-261, phase 2a and 2b). Windows PowerShell 5.1 runs it; the core sends it on the first
# line of standard input and then one JSON request per line, and reads one JSON answer per line back.
#
# Reading and acting go only through UI Automation patterns (Invoke, Value, Toggle, ExpandCollapse, SelectionItem,
# ScrollItem): they never move the real cursor, never send keys or mouse input and never bring a window to the front. A
# step UI Automation cannot do in the background comes back as "not possible", never as a fallback to real input.
#
# The one exception is a borrow (phase 2b), which the core sends only after the person allowed it on a card: it brings
# the window forward, sends the planned clicks, text, keys or wheel turns with SendInput, all tagged as Orglet's own,
# and gives the window and the cursor back. Low-level hooks watch for any input without that tag, which is the
# person's, and stop the borrow at once; Escape is kept from the app. A notice stays on top while it runs.
#
# The C# below is compiled in memory by the .NET Framework on this computer; nothing new is installed.

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes, System.Drawing, System.Web.Extensions, System.Windows.Forms
Add-Type -ReferencedAssemblies UIAutomationClient, UIAutomationTypes, WindowsBase, System.Drawing, System.Web.Extensions, System.Windows.Forms -Language CSharp -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Automation;
using System.Windows.Forms;

namespace OrgletDesktop {
  static class Native {
    [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr window);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr window);
    [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr window);
    [DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr window, uint flags);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr window, out Rect rect);
    [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr window, IntPtr deviceContext, uint flags);
    [DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr window, int index);
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] public static extern bool GetCursorPos(out PointStruct point);
    [DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr window, int attribute, out int value, int size);
    [DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr window, int attribute, out Rect value, int size);
    [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr context);
    [DllImport("kernel32.dll", SetLastError = true)] public static extern IntPtr OpenProcess(uint access, bool inherit, uint processId);
    [DllImport("kernel32.dll")] public static extern bool CloseHandle(IntPtr handle);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] public static extern bool QueryFullProcessImageName(IntPtr process, uint flags, StringBuilder name, ref uint size);
    [DllImport("kernel32.dll")] public static extern IntPtr GetCurrentProcess();
    [DllImport("advapi32.dll", SetLastError = true)] public static extern bool OpenProcessToken(IntPtr process, uint access, out IntPtr token);
    [DllImport("advapi32.dll", SetLastError = true)] public static extern bool GetTokenInformation(IntPtr token, int informationClass, IntPtr information, int length, out int returnedLength);
    [DllImport("advapi32.dll")] public static extern IntPtr GetSidSubAuthority(IntPtr sid, uint index);
    [DllImport("advapi32.dll")] public static extern IntPtr GetSidSubAuthorityCount(IntPtr sid);

    [StructLayout(LayoutKind.Sequential)] public struct Rect { public int Left; public int Top; public int Right; public int Bottom; }
    [StructLayout(LayoutKind.Sequential)] public struct PointStruct { public int X; public int Y; }

    // Borrowing the real mouse and keyboard (phase 2b).
    [DllImport("user32.dll", SetLastError = true)] public static extern uint SendInput(uint count, Input[] inputs, int size);
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr window);
    [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr window);
    [DllImport("user32.dll")] public static extern void SwitchToThisWindow(IntPtr window, bool altTab);
    [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint attach, uint attachTo, bool doAttach);
    [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
    [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
    [DllImport("user32.dll")] public static extern IntPtr WindowFromPoint(PointStruct point);
    [DllImport("user32.dll")] public static extern IntPtr MonitorFromPoint(PointStruct point, uint flags);
    [DllImport("user32.dll")] public static extern int GetSystemMetrics(int index);
    [DllImport("user32.dll")] public static extern bool GetGUIThreadInfo(uint threadId, ref GuiThreadInfo info);
    [DllImport("user32.dll", SetLastError = true)] public static extern IntPtr SetWindowsHookEx(int hook, HookProcedure procedure, IntPtr module, uint threadId);
    [DllImport("user32.dll")] public static extern bool UnhookWindowsHookEx(IntPtr hook);
    [DllImport("user32.dll")] public static extern IntPtr CallNextHookEx(IntPtr hook, int code, IntPtr wParam, IntPtr lParam);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] public static extern IntPtr GetModuleHandle(string name);
    [DllImport("user32.dll", SetLastError = true)] public static extern IntPtr OpenInputDesktop(uint flags, bool inherit, uint access);
    [DllImport("user32.dll")] public static extern bool CloseDesktop(IntPtr desktop);
    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)] public static extern bool GetUserObjectInformation(IntPtr handle, int index, StringBuilder information, int length, out int needed);
    [DllImport("user32.dll")] public static extern bool PeekMessage(out MessageStruct message, IntPtr window, uint filterMinimum, uint filterMaximum, uint remove);
    [DllImport("dwmapi.dll")] public static extern int DwmSetWindowAttribute(IntPtr window, int attribute, ref int value, int size);

    public delegate IntPtr HookProcedure(int code, IntPtr wParam, IntPtr lParam);

    [StructLayout(LayoutKind.Sequential)] public struct MouseInput { public int X; public int Y; public uint MouseData; public uint Flags; public uint Time; public IntPtr ExtraInfo; }
    [StructLayout(LayoutKind.Sequential)] public struct KeyboardInput { public ushort VirtualKey; public ushort Scan; public uint Flags; public uint Time; public IntPtr ExtraInfo; }
    [StructLayout(LayoutKind.Explicit)] public struct InputUnion { [FieldOffset(0)] public MouseInput Mouse; [FieldOffset(0)] public KeyboardInput Keyboard; }
    [StructLayout(LayoutKind.Sequential)] public struct Input { public uint Type; public InputUnion Data; }
    [StructLayout(LayoutKind.Sequential)] public struct MouseHookData { public PointStruct Point; public uint MouseData; public uint Flags; public uint Time; public IntPtr ExtraInfo; }
    [StructLayout(LayoutKind.Sequential)] public struct KeyboardHookData { public uint VirtualKey; public uint Scan; public uint Flags; public uint Time; public IntPtr ExtraInfo; }
    [StructLayout(LayoutKind.Sequential)] public struct GuiThreadInfo { public int Size; public uint Flags; public IntPtr Active; public IntPtr Focus; public IntPtr Capture; public IntPtr MenuOwner; public IntPtr MoveSize; public IntPtr Caret; public Rect CaretRect; }
    [StructLayout(LayoutKind.Sequential)] public struct MessageStruct { public IntPtr Window; public uint Message; public IntPtr WParam; public IntPtr LParam; public uint Time; public PointStruct Point; }

    public const uint InputMouse = 0;
    public const uint InputKeyboard = 1;
    public const uint MouseMove = 0x0001;
    public const uint MouseLeftDown = 0x0002;
    public const uint MouseLeftUp = 0x0004;
    public const uint MouseWheel = 0x0800;
    public const uint MouseVirtualDesk = 0x4000;
    public const uint MouseAbsolute = 0x8000;
    public const uint KeyExtended = 0x0001;
    public const uint KeyUp = 0x0002;
    public const uint KeyUnicode = 0x0004;
    public const int WheelDelta = 120;
    public const int KeyboardLowLevel = 13;
    public const int MouseLowLevel = 14;
    public const int VirtualScreenLeft = 76;
    public const int VirtualScreenTop = 77;
    public const int VirtualScreenWidth = 78;
    public const int VirtualScreenHeight = 79;
    public const uint MonitorDefaultToNull = 0;
    public const uint DesktopReadObjects = 0x0001;
    public const int UserObjectName = 2;
    public const int DwmCornerPreference = 33;
    public const int DwmRound = 2;

    public const uint ProcessQueryLimitedInformation = 0x1000;
    public const uint TokenQuery = 0x0008;
    public const int TokenIntegrityLevel = 25;
    public const int DwmCloaked = 14;
    public const int DwmExtendedFrameBounds = 9;
    /// <summary>DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2: window rectangles, DWM bounds and UI Automation all in physical pixels.</summary>
    public static readonly IntPtr PerMonitorAware = new IntPtr(-4);
    public const uint RootAncestor = 2;
    public const uint RenderFullContent = 2;
    public const int StyleIndex = -16;
    public const int DefaultPushButton = 1;
  }

  /// <summary>What a window is and whether this helper may reach it.</summary>
  class WindowFacts {
    public long Handle;
    public string Title;
    public string ClassName;
    public int ProcessId;
    public string Executable;
    public bool Minimized;
    public bool Elevated;
  }

  public static class Host {
    const int MaximumNodes = 1500;
    const int MaximumDepth = 40;
    const int ValueCharacters = 300;
    const int DocumentCharacters = 4000;
    const int StepWaitMilliseconds = 5000;
    const int RequestWaitMilliseconds = 25000;

    static readonly JavaScriptSerializer Json = new JavaScriptSerializer { MaxJsonLength = int.MaxValue, RecursionLimit = 64 };
    static readonly object RefsLock = new object();
    /// <summary>The elements of each run's latest reading of each window, by ref: "runId|handle" to "e12" to element.</summary>
    static readonly Dictionary<string, Dictionary<string, AutomationElement>> Refs = new Dictionary<string, Dictionary<string, AutomationElement>>();
    static readonly List<string> RefOrder = new List<string>();
    static int ownIntegrity = -1;

    public static void Run() {
      Console.InputEncoding = new UTF8Encoding(false);
      Console.OutputEncoding = new UTF8Encoding(false);
      try {
        Native.SetProcessDpiAwarenessContext(Native.PerMonitorAware);
      } catch (EntryPointNotFoundException) {
        // Older Windows 10 builds: pictures are still taken, possibly with the outline slightly off on scaled screens.
      }
      ownIntegrity = IntegrityOf(Native.GetCurrentProcess());
      Write(new Dictionary<string, object> { { "ready", true } });
      string line;
      while ((line = Console.In.ReadLine()) != null) {
        if (line.Length == 0) continue;
        Answer(line);
      }
    }

    static void Write(object value) {
      Console.Out.WriteLine(Json.Serialize(value));
      Console.Out.Flush();
    }

    /// <summary>One request, answered on a worker thread so an app that stops answering cannot stall the helper.</summary>
    static void Answer(string line) {
      string requestId = null;
      try {
        var request = (Dictionary<string, object>)Json.DeserializeObject(line);
        requestId = request.ContainsKey("id") ? Convert.ToString(request["id"]) : null;
        object result = null;
        Exception failure = null;
        var worker = new Thread(() => {
          try { result = Handle(request); } catch (Exception error) { failure = error; }
        });
        worker.IsBackground = true;
        worker.SetApartmentState(ApartmentState.MTA);
        worker.Start();
        if (!worker.Join(RequestWaitMilliseconds)) {
          Write(new Dictionary<string, object> { { "id", requestId }, { "ok", false }, { "error", "app_not_answering" } });
          return;
        }
        if (failure != null) {
          var message = failure is ElementNotAvailableException ? "element_gone" : failure.GetType().Name + ": " + failure.Message;
          Write(new Dictionary<string, object> { { "id", requestId }, { "ok", false }, { "error", message } });
          return;
        }
        Write(new Dictionary<string, object> { { "id", requestId }, { "ok", true }, { "value", result } });
      } catch (Exception error) {
        Write(new Dictionary<string, object> { { "id", requestId }, { "ok", false }, { "error", error.GetType().Name + ": " + error.Message } });
      }
    }

    static object Handle(Dictionary<string, object> request) {
      var kind = Convert.ToString(request["kind"]);
      if (kind == "windows") return ListWindows();
      if (kind == "snapshot") return Snapshot(request);
      if (kind == "inspect") return Inspect(request);
      if (kind == "act") return Act(request);
      if (kind == "screenshot") return Screenshot(request);
      if (kind == "bounds") return Bounds(request);
      if (kind == "borrow_check") return Borrowing.Check(request);
      if (kind == "borrow") return Borrowing.Borrow(request);
      if (kind == "borrow_stop") return Borrowing.StopCurrent();
      if (kind == "forget") return Forget(request);
      throw new ArgumentException("unknown request " + kind);
    }

    static Dictionary<string, object> Problem(string problem) {
      return new Dictionary<string, object> { { "problem", problem } };
    }

    // ----- Windows and processes -----

    static int IntegrityOf(IntPtr process) {
      IntPtr token;
      if (!Native.OpenProcessToken(process, Native.TokenQuery, out token)) return -1;
      try {
        int length;
        Native.GetTokenInformation(token, Native.TokenIntegrityLevel, IntPtr.Zero, 0, out length);
        if (length <= 0) return -1;
        var buffer = Marshal.AllocHGlobal(length);
        try {
          if (!Native.GetTokenInformation(token, Native.TokenIntegrityLevel, buffer, length, out length)) return -1;
          var sid = Marshal.ReadIntPtr(buffer);
          var count = Marshal.ReadByte(Native.GetSidSubAuthorityCount(sid));
          return Marshal.ReadInt32(Native.GetSidSubAuthority(sid, (uint)(count - 1)));
        } finally {
          Marshal.FreeHGlobal(buffer);
        }
      } finally {
        Native.CloseHandle(token);
      }
    }

    /// <summary>The program's file name in lowercase, and whether it runs above this helper (UI Automation cannot reach it then).</summary>
    static void ProcessFacts(int processId, out string executable, out bool elevated) {
      executable = "";
      elevated = true;
      var process = Native.OpenProcess(Native.ProcessQueryLimitedInformation, false, (uint)processId);
      if (process == IntPtr.Zero) return;
      try {
        var name = new StringBuilder(1024);
        uint size = (uint)name.Capacity;
        if (Native.QueryFullProcessImageName(process, 0, name, ref size)) executable = Path.GetFileName(name.ToString()).ToLowerInvariant();
        var integrity = IntegrityOf(process);
        elevated = integrity < 0 || integrity > ownIntegrity;
      } finally {
        Native.CloseHandle(process);
      }
    }

    static bool Cloaked(IntPtr window) {
      int cloaked;
      return Native.DwmGetWindowAttribute(window, Native.DwmCloaked, out cloaked, 4) == 0 && cloaked != 0;
    }

    /// <summary>A Store app's frame belongs to ApplicationFrameHost; the app itself is the process of its core window inside.</summary>
    static int FramedProcess(AutomationElement window) {
      var condition = new PropertyCondition(AutomationElement.ClassNameProperty, "Windows.UI.Core.CoreWindow");
      var inner = window.FindFirst(TreeScope.Children, condition);
      return inner == null ? 0 : inner.Current.ProcessId;
    }

    static WindowFacts FactsOf(AutomationElement element) {
      var current = element.Current;
      var facts = new WindowFacts();
      facts.Handle = current.NativeWindowHandle;
      facts.Title = current.Name ?? "";
      facts.ClassName = current.ClassName ?? "";
      facts.ProcessId = current.ProcessId;
      facts.Minimized = Native.IsIconic(new IntPtr(facts.Handle));
      string executable;
      bool elevated;
      ProcessFacts(facts.ProcessId, out executable, out elevated);
      if (executable == "applicationframehost.exe") {
        var inner = FramedProcess(element);
        if (inner != 0) {
          facts.ProcessId = inner;
          ProcessFacts(inner, out executable, out elevated);
        }
      }
      facts.Executable = executable;
      facts.Elevated = elevated;
      return facts;
    }

    static Dictionary<string, object> WindowView(WindowFacts facts) {
      return new Dictionary<string, object> {
        { "handle", facts.Handle }, { "title", facts.Title }, { "className", facts.ClassName }, { "processId", facts.ProcessId },
        { "executable", facts.Executable }, { "minimized", facts.Minimized }, { "elevated", facts.Elevated },
      };
    }

    /// <summary>Every visible top-level window on this desktop, with its program. The core decides which of them a chat sees.</summary>
    static object ListWindows() {
      var windows = new List<object>();
      var children = AutomationElement.RootElement.FindAll(TreeScope.Children, Condition.TrueCondition);
      foreach (AutomationElement child in children) {
        try {
          var handle = new IntPtr(child.Current.NativeWindowHandle);
          if (handle == IntPtr.Zero || !Native.IsWindowVisible(handle) || Cloaked(handle)) continue;
          windows.Add(WindowView(FactsOf(child)));
        } catch (ElementNotAvailableException) {
          // A window that closed while the list was read is simply not on it.
        }
      }
      return new Dictionary<string, object> { { "windows", windows } };
    }

    static HashSet<string> AllowedPrograms(Dictionary<string, object> request) {
      var allowed = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
      object list;
      if (request.TryGetValue("allow", out list) && list is object[]) {
        foreach (var item in (object[])list) allowed.Add(Convert.ToString(item));
      }
      return allowed;
    }

    /// <summary>
    /// The window a request names, checked again here: it still exists, it is a top-level window, its program is one the
    /// chat granted, and it does not run above this helper. A handle Windows gave to another program since is refused.
    /// </summary>
    static AutomationElement GrantedWindow(Dictionary<string, object> request, out WindowFacts facts, out string problem) {
      facts = null;
      problem = null;
      var handle = new IntPtr(Convert.ToInt64(request["handle"]));
      if (!Native.IsWindow(handle) || Native.GetAncestor(handle, Native.RootAncestor) != handle) { problem = "window_gone"; return null; }
      var element = AutomationElement.FromHandle(handle);
      facts = FactsOf(element);
      if (!AllowedPrograms(request).Contains(facts.Executable)) { problem = "not_granted"; return null; }
      if (facts.Elevated) { problem = "elevated"; return null; }
      return element;
    }

    // ----- Reading -----

    static string Words(string programmaticName) {
      var name = programmaticName.StartsWith("ControlType.") ? programmaticName.Substring(12) : programmaticName;
      var words = new StringBuilder();
      for (var index = 0; index < name.Length; index++) {
        if (index > 0 && char.IsUpper(name[index]) && !char.IsUpper(name[index - 1])) words.Append(' ');
        words.Append(char.ToLowerInvariant(name[index]));
      }
      return words.ToString();
    }

    static string Quoted(string text, int limit) {
      var single = (text ?? "").Replace("\r\n", "\\n").Replace("\n", "\\n").Replace("\r", "\\n").Replace("\"", "'");
      if (single.Length > limit) single = single.Substring(0, limit) + "...";
      return "\"" + single + "\"";
    }

    static CacheRequest ReadingRequest() {
      var request = new CacheRequest();
      request.TreeScope = TreeScope.Element | TreeScope.Children;
      request.TreeFilter = Automation.ControlViewCondition;
      request.AutomationElementMode = AutomationElementMode.Full;
      foreach (var property in new AutomationProperty[] {
        AutomationElement.NameProperty, AutomationElement.ControlTypeProperty, AutomationElement.IsEnabledProperty, AutomationElement.IsPasswordProperty,
        AutomationElement.HasKeyboardFocusProperty, AutomationElement.IsOffscreenProperty, AutomationElement.NativeWindowHandleProperty,
        AutomationElement.IsInvokePatternAvailableProperty, AutomationElement.IsValuePatternAvailableProperty, AutomationElement.IsTogglePatternAvailableProperty,
        AutomationElement.IsExpandCollapsePatternAvailableProperty, AutomationElement.IsSelectionItemPatternAvailableProperty,
        AutomationElement.IsScrollItemPatternAvailableProperty, AutomationElement.IsTextPatternAvailableProperty,
        ValuePattern.ValueProperty, ValuePattern.IsReadOnlyProperty, TogglePattern.ToggleStateProperty,
        ExpandCollapsePattern.ExpandCollapseStateProperty, SelectionItemPattern.IsSelectedProperty,
      }) request.Add(property);
      return request;
    }

    static bool Flag(AutomationElement element, AutomationProperty property) {
      var value = element.GetCachedPropertyValue(property, true);
      return value is bool && (bool)value;
    }

    static object Cached(AutomationElement element, AutomationProperty property) {
      var value = element.GetCachedPropertyValue(property, true);
      return value == AutomationElement.NotSupported ? null : value;
    }

    static List<string> Actions(AutomationElement element) {
      var actions = new List<string>();
      if (!Flag(element, AutomationElement.IsEnabledProperty)) return actions;
      if (Flag(element, AutomationElement.IsInvokePatternAvailableProperty)) actions.Add("invoke");
      var readOnly = Cached(element, ValuePattern.IsReadOnlyProperty);
      if (Flag(element, AutomationElement.IsValuePatternAvailableProperty) && !(readOnly is bool && (bool)readOnly) && !Flag(element, AutomationElement.IsPasswordProperty)) actions.Add("set_value");
      if (Flag(element, AutomationElement.IsTogglePatternAvailableProperty)) actions.Add("toggle");
      if (Flag(element, AutomationElement.IsExpandCollapsePatternAvailableProperty)) actions.Add("expand");
      if (Flag(element, AutomationElement.IsSelectionItemPatternAvailableProperty)) actions.Add("select");
      if (Flag(element, AutomationElement.IsScrollItemPatternAvailableProperty)) actions.Add("scroll_into_view");
      return actions;
    }

    static string DocumentText(AutomationElement element) {
      try {
        var pattern = (TextPattern)element.GetCurrentPattern(TextPattern.Pattern);
        return pattern.DocumentRange.GetText(DocumentCharacters);
      } catch (Exception) {
        return null;
      }
    }

    /// <summary>One element as one snapshot line: its kind, name, ref, value and states, then what it can do.</summary>
    static string Line(AutomationElement element, string reference, int depth) {
      var controlType = (ControlType)element.GetCachedPropertyValue(AutomationElement.ControlTypeProperty);
      var line = new StringBuilder();
      line.Append(new string(' ', depth * 2)).Append("- ").Append(Words(controlType.ProgrammaticName));
      var name = (string)Cached(element, AutomationElement.NameProperty);
      if (!string.IsNullOrEmpty(name)) line.Append(' ').Append(Quoted(name, 200));
      line.Append(" [ref=").Append(reference).Append(']');
      var password = Flag(element, AutomationElement.IsPasswordProperty);
      if (password) {
        line.Append(" [password]");
      } else if (Flag(element, AutomationElement.IsValuePatternAvailableProperty)) {
        var value = Cached(element, ValuePattern.ValueProperty) as string;
        if (!string.IsNullOrEmpty(value) && value != name) line.Append(" value=").Append(Quoted(value, ValueCharacters));
      } else if (Flag(element, AutomationElement.IsTextPatternAvailableProperty) && (controlType == ControlType.Document || controlType == ControlType.Edit)) {
        var text = DocumentText(element);
        if (!string.IsNullOrEmpty(text)) line.Append(" text=").Append(Quoted(text, DocumentCharacters));
      }
      var states = new List<string>();
      if (!Flag(element, AutomationElement.IsEnabledProperty)) states.Add("disabled");
      if (Flag(element, AutomationElement.HasKeyboardFocusProperty)) states.Add("focused");
      var readOnly = Cached(element, ValuePattern.IsReadOnlyProperty);
      if (readOnly is bool && (bool)readOnly && (controlType == ControlType.Edit || controlType == ControlType.Document)) states.Add("read-only");
      var toggle = Cached(element, TogglePattern.ToggleStateProperty);
      if (toggle is ToggleState) states.Add((ToggleState)toggle == ToggleState.On ? "checked" : (ToggleState)toggle == ToggleState.Off ? "unchecked" : "mixed");
      var expand = Cached(element, ExpandCollapsePattern.ExpandCollapseStateProperty);
      if (expand is ExpandCollapseState && (ExpandCollapseState)expand != ExpandCollapseState.LeafNode) states.Add((ExpandCollapseState)expand == ExpandCollapseState.Collapsed ? "collapsed" : "expanded");
      var selected = Cached(element, SelectionItemPattern.IsSelectedProperty);
      if (selected is bool && (bool)selected) states.Add("selected");
      if (IsDefaultButton(element, controlType)) states.Add("default");
      foreach (var state in states) line.Append(" [").Append(state).Append(']');
      var actions = Actions(element);
      if (actions.Count > 0) line.Append(" actions=").Append(string.Join(",", actions.ToArray()));
      return line.ToString();
    }

    static bool IsDefaultButton(AutomationElement element, ControlType controlType) {
      if (controlType != ControlType.Button) return false;
      var handle = Cached(element, AutomationElement.NativeWindowHandleProperty);
      if (!(handle is int) || (int)handle == 0) return false;
      return (Native.GetWindowLong(new IntPtr((int)handle), Native.StyleIndex) & 0x0F) == Native.DefaultPushButton;
    }

    static void Walk(AutomationElement element, int depth, CacheRequest reading, StringBuilder lines, Dictionary<string, AutomationElement> refs, ref bool truncated) {
      if (refs.Count >= MaximumNodes) { truncated = true; return; }
      var reference = "e" + (refs.Count + 1);
      refs[reference] = element;
      lines.Append(Line(element, reference, depth)).Append('\n');
      if (depth >= MaximumDepth) return;
      AutomationElement withChildren;
      try {
        withChildren = element.GetUpdatedCache(reading);
      } catch (ElementNotAvailableException) {
        return;
      }
      foreach (AutomationElement child in withChildren.CachedChildren) {
        if (refs.Count >= MaximumNodes) { truncated = true; return; }
        Walk(child, depth + 1, reading, lines, refs, ref truncated);
      }
    }

    static string RefKey(Dictionary<string, object> request) {
      return Convert.ToString(request["runId"]) + "|" + Convert.ToString(request["handle"]);
    }

    static void KeepRefs(string key, Dictionary<string, AutomationElement> refs) {
      lock (RefsLock) {
        Refs[key] = refs;
        RefOrder.Remove(key);
        RefOrder.Add(key);
        while (RefOrder.Count > 40) {
          Refs.Remove(RefOrder[0]);
          RefOrder.RemoveAt(0);
        }
      }
    }

    static AutomationElement RefElement(Dictionary<string, object> request) {
      lock (RefsLock) {
        Dictionary<string, AutomationElement> refs;
        if (!Refs.TryGetValue(RefKey(request), out refs)) return null;
        AutomationElement element;
        return refs.TryGetValue(Convert.ToString(request["ref"]), out element) ? element : null;
      }
    }

    static object Forget(Dictionary<string, object> request) {
      var prefix = Convert.ToString(request["runId"]) + "|";
      lock (RefsLock) {
        foreach (var key in RefOrder.ToArray()) {
          if (!key.StartsWith(prefix)) continue;
          Refs.Remove(key);
          RefOrder.Remove(key);
        }
      }
      return new Dictionary<string, object> { { "forgotten", true } };
    }

    /// <summary>The window's UI Automation tree as text, one element per line with refs, kept for the run's next steps.</summary>
    static object Snapshot(Dictionary<string, object> request) {
      WindowFacts facts;
      string problem;
      var window = GrantedWindow(request, out facts, out problem);
      if (window == null) return Problem(problem);
      var reading = ReadingRequest();
      AutomationElement cachedWindow;
      using (reading.Activate()) {
        cachedWindow = AutomationElement.FromHandle(new IntPtr(facts.Handle));
      }
      var lines = new StringBuilder();
      var refs = new Dictionary<string, AutomationElement>();
      var truncated = false;
      Walk(cachedWindow, 0, reading, lines, refs, ref truncated);
      KeepRefs(RefKey(request), refs);
      var result = WindowView(facts);
      result["snapshot"] = lines.ToString();
      result["elements"] = refs.Count;
      result["truncated"] = truncated;
      return result;
    }

    /// <summary>The nearest window above an element, and whether it is a dialog: a Win32 dialog class or a modal window.</summary>
    static bool InDialog(AutomationElement element, out string windowName) {
      windowName = "";
      var walker = TreeWalker.ControlViewWalker;
      var current = element;
      for (var steps = 0; current != null && steps < 60; steps++) {
        var info = current.Current;
        if (info.ControlType == ControlType.Window) {
          windowName = info.Name ?? "";
          if (info.ClassName == "#32770") return true;
          object pattern;
          if (current.TryGetCurrentPattern(WindowPattern.Pattern, out pattern) && ((WindowPattern)pattern).Current.IsModal) return true;
          return false;
        }
        current = walker.GetParent(current);
        if (current == AutomationElement.RootElement) break;
      }
      return false;
    }

    static List<string> LiveActions(AutomationElement element) {
      var actions = new List<string>();
      object pattern;
      if (element.TryGetCurrentPattern(InvokePattern.Pattern, out pattern)) actions.Add("invoke");
      if (element.TryGetCurrentPattern(ValuePattern.Pattern, out pattern) && !((ValuePattern)pattern).Current.IsReadOnly) actions.Add("set_value");
      if (element.TryGetCurrentPattern(TogglePattern.Pattern, out pattern)) actions.Add("toggle");
      if (element.TryGetCurrentPattern(ExpandCollapsePattern.Pattern, out pattern)) actions.Add("expand");
      if (element.TryGetCurrentPattern(SelectionItemPattern.Pattern, out pattern)) actions.Add("select");
      if (element.TryGetCurrentPattern(ScrollItemPattern.Pattern, out pattern)) actions.Add("scroll_into_view");
      return actions;
    }

    /// <summary>What the core needs to judge a step on one element, read live: the element may have changed since the snapshot.</summary>
    static object Inspect(Dictionary<string, object> request) {
      WindowFacts facts;
      string problem;
      var window = GrantedWindow(request, out facts, out problem);
      if (window == null) return Problem(problem);
      var result = WindowView(facts);
      var element = RefElement(request);
      if (element == null) { result["target"] = null; return result; }
      try {
        var info = element.Current;
        if (info.ProcessId != facts.ProcessId && facts.Executable != "") { result["target"] = null; return result; }
        string windowName;
        var dialog = InDialog(element, out windowName);
        var handle = info.NativeWindowHandle;
        var defaultButton = info.ControlType == ControlType.Button && handle != 0
          && (Native.GetWindowLong(new IntPtr(handle), Native.StyleIndex) & 0x0F) == Native.DefaultPushButton;
        var box = info.BoundingRectangle;
        var hasBox = !box.IsEmpty && box.Width >= 1 && box.Height >= 1;
        result["target"] = new Dictionary<string, object> {
          { "ref", Convert.ToString(request["ref"]) }, { "name", info.Name ?? "" }, { "controlType", Words(info.ControlType.ProgrammaticName) },
          { "automationId", info.AutomationId ?? "" }, { "className", info.ClassName ?? "" }, { "enabled", info.IsEnabled }, { "password", info.IsPassword },
          { "actions", LiveActions(element) }, { "inDialog", dialog }, { "defaultButton", defaultButton }, { "windowName", windowName },
          // Where the element is on screen, in physical pixels, for the orglet's cursor on the glow; never used to act.
          { "box", hasBox ? new Dictionary<string, object> { { "x", (int)Math.Round(box.X) }, { "y", (int)Math.Round(box.Y) }, { "width", (int)Math.Round(box.Width) }, { "height", (int)Math.Round(box.Height) } } : null },
        };
      } catch (ElementNotAvailableException) {
        result["target"] = null;
      }
      return result;
    }

    // ----- Acting -----

    static bool SameElement(AutomationElement element, Dictionary<string, object> expect) {
      var info = element.Current;
      return (info.Name ?? "") == Convert.ToString(expect["name"]) && Words(info.ControlType.ProgrammaticName) == Convert.ToString(expect["controlType"]);
    }

    static Dictionary<string, object> StateOf(AutomationElement element) {
      var state = new Dictionary<string, object>();
      try {
        object pattern;
        if (!element.Current.IsPassword && element.TryGetCurrentPattern(ValuePattern.Pattern, out pattern)) {
          var value = ((ValuePattern)pattern).Current.Value ?? "";
          state["value"] = value.Length > ValueCharacters ? value.Substring(0, ValueCharacters) + "..." : value;
        }
        if (element.TryGetCurrentPattern(TogglePattern.Pattern, out pattern)) state["toggle"] = ((TogglePattern)pattern).Current.ToggleState.ToString().ToLowerInvariant();
        if (element.TryGetCurrentPattern(ExpandCollapsePattern.Pattern, out pattern)) state["expand"] = ((ExpandCollapsePattern)pattern).Current.ExpandCollapseState.ToString().ToLowerInvariant();
        if (element.TryGetCurrentPattern(SelectionItemPattern.Pattern, out pattern)) state["selected"] = ((SelectionItemPattern)pattern).Current.IsSelected;
      } catch (ElementNotAvailableException) {
        state["gone"] = true;
      }
      return state;
    }

    /// <summary>
    /// One pattern call on the element, waited for at most five seconds: a button that opens a modal dialog keeps the call
    /// open until the dialog closes, so the step then reports that the app is still busy instead of stalling.
    /// </summary>
    static object Act(Dictionary<string, object> request) {
      WindowFacts facts;
      string problem;
      var window = GrantedWindow(request, out facts, out problem);
      if (window == null) return Problem(problem);
      var element = RefElement(request);
      if (element == null) return Problem("stale");
      var step = (Dictionary<string, object>)request["step"];
      var kind = Convert.ToString(step["kind"]);
      try {
        if (!SameElement(element, (Dictionary<string, object>)request["expect"])) return Problem("stale");
        if (!element.Current.IsEnabled) return Problem("disabled");
      } catch (ElementNotAvailableException) {
        return Problem("stale");
      }
      Action perform;
      object pattern;
      if (kind == "invoke") {
        if (!element.TryGetCurrentPattern(InvokePattern.Pattern, out pattern)) return Problem("not_possible");
        var invoke = (InvokePattern)pattern;
        perform = () => invoke.Invoke();
      } else if (kind == "set_value") {
        if (element.Current.IsPassword) return Problem("password");
        if (!element.TryGetCurrentPattern(ValuePattern.Pattern, out pattern) || ((ValuePattern)pattern).Current.IsReadOnly) return Problem("not_possible");
        var value = (ValuePattern)pattern;
        var text = Convert.ToString(step["text"]);
        perform = () => value.SetValue(text);
      } else if (kind == "toggle") {
        if (!element.TryGetCurrentPattern(TogglePattern.Pattern, out pattern)) return Problem("not_possible");
        var toggle = (TogglePattern)pattern;
        perform = () => toggle.Toggle();
      } else if (kind == "expand" || kind == "collapse") {
        if (!element.TryGetCurrentPattern(ExpandCollapsePattern.Pattern, out pattern)) return Problem("not_possible");
        var expandCollapse = (ExpandCollapsePattern)pattern;
        if (kind == "expand") perform = () => expandCollapse.Expand();
        else perform = () => expandCollapse.Collapse();
      } else if (kind == "select") {
        if (!element.TryGetCurrentPattern(SelectionItemPattern.Pattern, out pattern)) return Problem("not_possible");
        var selection = (SelectionItemPattern)pattern;
        perform = () => selection.Select();
      } else if (kind == "scroll_into_view") {
        if (!element.TryGetCurrentPattern(ScrollItemPattern.Pattern, out pattern)) return Problem("not_possible");
        var scroll = (ScrollItemPattern)pattern;
        perform = () => scroll.ScrollIntoView();
      } else {
        throw new ArgumentException("unknown step " + kind);
      }

      Native.PointStruct cursorBefore;
      Native.GetCursorPos(out cursorBefore);
      var foregroundBefore = Native.GetForegroundWindow();
      Exception failure = null;
      var worker = new Thread(() => {
        try { perform(); } catch (Exception error) { failure = error; }
      });
      worker.IsBackground = true;
      worker.SetApartmentState(ApartmentState.MTA);
      worker.Start();
      var finished = worker.Join(StepWaitMilliseconds);
      Native.PointStruct cursorAfter;
      Native.GetCursorPos(out cursorAfter);
      var foregroundAfter = Native.GetForegroundWindow();
      if (finished && failure != null) {
        if (failure is ElementNotAvailableException) return Problem("stale");
        if (failure is InvalidOperationException) return Problem("not_possible");
        throw failure;
      }
      var result = new Dictionary<string, object> {
        { "done", true }, { "pending", !finished }, { "state", finished ? StateOf(element) : new Dictionary<string, object>() },
        { "cursorMoved", cursorBefore.X != cursorAfter.X || cursorBefore.Y != cursorAfter.Y },
        { "foregroundChanged", foregroundBefore != foregroundAfter },
      };
      try {
        result["title"] = AutomationElement.FromHandle(new IntPtr(facts.Handle)).Current.Name ?? "";
      } catch (Exception) {
        result["title"] = facts.Title;
      }
      return result;
    }

    /// <summary>Where a granted window's visible frame is now, in physical pixels, for the glow around it. Reads nothing inside it.</summary>
    static object Bounds(Dictionary<string, object> request) {
      WindowFacts facts;
      string problem;
      var window = GrantedWindow(request, out facts, out problem);
      if (window == null) return Problem(problem);
      if (facts.Minimized) return Problem("minimized");
      var handle = new IntPtr(facts.Handle);
      Native.Rect frame;
      if (Native.DwmGetWindowAttribute(handle, Native.DwmExtendedFrameBounds, out frame, Marshal.SizeOf(typeof(Native.Rect))) != 0 && !Native.GetWindowRect(handle, out frame)) return Problem("window_gone");
      var width = frame.Right - frame.Left;
      var height = frame.Bottom - frame.Top;
      if (width <= 0 || height <= 0) return Problem("minimized");
      return new Dictionary<string, object> { { "bounds", new Dictionary<string, object> { { "x", frame.Left }, { "y", frame.Top }, { "width", width }, { "height", height } } } };
    }

    // ----- Borrowing the real mouse and keyboard (phase 2b) -----

    /// <summary>
    /// A few planned steps with the person's real mouse and keyboard on one element, after they allowed it on a card:
    /// click it, type into it, press keys in it or turn the wheel over it. Nothing here runs without a "borrow" request,
    /// and the core sends one only for the steps the person saw.
    /// </summary>
    static class Borrowing {
      static int running;
      static volatile Session current;

      /// <summary>Whether Windows shows the normal desktop, rather than an administrator prompt or the lock screen.</summary>
      static bool OnNormalDesktop() {
        var desktop = Native.OpenInputDesktop(0, false, Native.DesktopReadObjects);
        if (desktop == IntPtr.Zero) return false;
        try {
          var name = new StringBuilder(256);
          int needed;
          if (!Native.GetUserObjectInformation(desktop, Native.UserObjectName, name, name.Capacity * 2, out needed)) return false;
          return string.Equals(name.ToString(), "Default", StringComparison.OrdinalIgnoreCase);
        } finally {
          Native.CloseDesktop(desktop);
        }
      }

      /// <summary>Where the mouse would click the element: its clickable point, or the middle of its box.</summary>
      internal static bool PointOf(AutomationElement element, out Native.PointStruct point) {
        point = new Native.PointStruct();
        System.Windows.Point clickable;
        if (element.TryGetClickablePoint(out clickable)) {
          point.X = (int)Math.Round(clickable.X);
          point.Y = (int)Math.Round(clickable.Y);
          return true;
        }
        var box = element.Current.BoundingRectangle;
        if (box.IsEmpty || box.Width < 1 || box.Height < 1) return false;
        point.X = (int)Math.Round(box.X + box.Width / 2);
        point.Y = (int)Math.Round(box.Y + box.Height / 2);
        return true;
      }

      /// <summary>
      /// Everything a borrow needs, checked without sending any input: the window is granted, not elevated and not
      /// minimized, the element is the one judged, enabled, not a password field and not the window itself, it has a
      /// point on a screen inside its window, and Windows shows the normal desktop.
      /// </summary>
      static AutomationElement Ready(Dictionary<string, object> request, out WindowFacts facts, out Native.PointStruct point, out string problem) {
        point = new Native.PointStruct();
        var window = GrantedWindow(request, out facts, out problem);
        if (window == null) return null;
        if (facts.Minimized) { problem = "minimized"; return null; }
        var element = RefElement(request);
        if (element == null) { problem = "stale"; return null; }
        try {
          if (!SameElement(element, (Dictionary<string, object>)request["expect"])) { problem = "stale"; return null; }
          var info = element.Current;
          if (info.IsPassword) { problem = "password"; return null; }
          if (!info.IsEnabled) { problem = "disabled"; return null; }
          if (info.ControlType == ControlType.Window || info.NativeWindowHandle == facts.Handle) { problem = "not_possible"; return null; }
          if (!PointOf(element, out point)) { problem = "off_screen"; return null; }
        } catch (ElementNotAvailableException) {
          problem = "stale";
          return null;
        }
        Native.Rect bounds;
        if (!Native.GetWindowRect(new IntPtr(facts.Handle), out bounds)) { problem = "window_gone"; return null; }
        var inside = point.X >= bounds.Left && point.X < bounds.Right && point.Y >= bounds.Top && point.Y < bounds.Bottom;
        if (!inside || Native.MonitorFromPoint(point, Native.MonitorDefaultToNull) == IntPtr.Zero) { problem = "off_screen"; return null; }
        if (!OnNormalDesktop()) { problem = "secure_desktop"; return null; }
        return element;
      }

      public static object Check(Dictionary<string, object> request) {
        WindowFacts facts;
        Native.PointStruct point;
        string problem;
        var element = Ready(request, out facts, out point, out problem);
        if (element == null) return Problem(problem);
        var result = WindowView(facts);
        result["point"] = new Dictionary<string, object> { { "x", point.X }, { "y", point.Y } };
        return result;
      }

      public static object StopCurrent() {
        var session = current;
        if (session != null) session.Stop("run_stopped");
        return new Dictionary<string, object> { { "stopping", session != null } };
      }

      public static object Borrow(Dictionary<string, object> request) {
        if (Interlocked.CompareExchange(ref running, 1, 0) != 0) return Problem("busy");
        try {
          WindowFacts facts;
          Native.PointStruct point;
          string problem;
          var element = Ready(request, out facts, out point, out problem);
          if (element == null) return Problem(problem);
          var steps = new List<Dictionary<string, object>>();
          foreach (var step in (object[])request["steps"]) steps.Add((Dictionary<string, object>)step);
          var session = new Session(new IntPtr(facts.Handle), element, Convert.ToInt32(request["limitMs"]), Convert.ToString(request["indicator"]), point);
          current = session;
          try {
            var result = session.Run(steps);
            try {
              result["title"] = AutomationElement.FromHandle(new IntPtr(facts.Handle)).Current.Name ?? "";
            } catch (Exception) {
              result["title"] = facts.Title;
            }
            return result;
          } finally {
            current = null;
          }
        } finally {
          Interlocked.Exchange(ref running, 0);
        }
      }
    }

    /// <summary>
    /// The notice on top of everything while a borrow runs. It never takes the focus or a click: it is a tool window
    /// that does not activate and lets the mouse through.
    /// </summary>
    sealed class Indicator : Form {
      const int ExtendedTopMost = 0x00000008;
      const int ExtendedTransparent = 0x00000020;
      const int ExtendedToolWindow = 0x00000080;
      const int ExtendedLayered = 0x00080000;
      const int ExtendedNoActivate = 0x08000000;

      public Indicator(string text, Rectangle area, Native.PointStruct avoid) {
        FormBorderStyle = FormBorderStyle.None;
        ShowInTaskbar = false;
        // Set before the window exists, so it is created on top rather than moved there, which could activate it.
        TopMost = true;
        StartPosition = FormStartPosition.Manual;
        BackColor = Color.FromArgb(28, 28, 30);
        ForeColor = Color.White;
        Opacity = 0.94;
        var font = new Font("Segoe UI", 10.5f, FontStyle.Regular, GraphicsUnit.Point);
        var label = new Label { Text = text, Font = font, ForeColor = Color.White, BackColor = Color.Transparent, AutoSize = true, Padding = new Padding(0) };
        var measured = TextRenderer.MeasureText(text, font);
        var horizontal = (int)Math.Round(font.Height * 1.1);
        var vertical = (int)Math.Round(font.Height * 0.6);
        Size = new Size(measured.Width + horizontal * 2, measured.Height + vertical * 2);
        label.Location = new Point(horizontal, vertical);
        Controls.Add(label);
        var left = area.Left + (area.Width - Width) / 2;
        var top = area.Top + 16;
        // Kept away from the point the mouse will use, so it never sits over what is being clicked.
        if (avoid.Y >= top - 24 && avoid.Y <= top + Height + 24) top = area.Bottom - Height - 16;
        Location = new Point(left, top);
      }

      protected override bool ShowWithoutActivation { get { return true; } }

      protected override CreateParams CreateParams {
        get {
          var parameters = base.CreateParams;
          parameters.ExStyle |= ExtendedTopMost | ExtendedTransparent | ExtendedToolWindow | ExtendedLayered | ExtendedNoActivate;
          return parameters;
        }
      }

      protected override void OnHandleCreated(EventArgs arguments) {
        base.OnHandleCreated(arguments);
        var round = Native.DwmRound;
        try {
          Native.DwmSetWindowAttribute(Handle, Native.DwmCornerPreference, ref round, 4);
        } catch (DllNotFoundException) {
          // Square corners on a Windows without that setting.
        }
      }
    }

    /// <summary>One borrow: the hooks and the notice on their own thread, and the steps on the calling one.</summary>
    sealed class Session {
      const int KeyDown = 0x0100;
      const int SystemKeyDown = 0x0104;
      const int MouseMoveMessage = 0x0200;
      const int LeftButtonUp = 0x0202;
      const int RightButtonUp = 0x0205;
      const int MiddleButtonUp = 0x0208;
      const int ExtraButtonUp = 0x020C;
      const uint EscapeKey = 0x1B;

      readonly IntPtr window;
      readonly AutomationElement element;
      readonly int limitMs;
      readonly string indicatorText;
      readonly Native.PointStruct firstPoint;
      /// <summary>Carried by every input Orglet sends, so the hooks can tell it from the person's.</summary>
      readonly IntPtr tag;
      readonly Stopwatch clock = new Stopwatch();
      readonly ManualResetEvent overlayReady = new ManualResetEvent(false);
      string stoppedBy;
      long stoppedAtTicks = -1;
      long lastInputTicks = -1;
      Native.HookProcedure mouseProcedure;
      Native.HookProcedure keyboardProcedure;
      Indicator indicator;
      Control anchor;
      Exception overlayFailure;
      Thread overlay;
      bool hooked;

      public Session(IntPtr window, AutomationElement element, int limitMs, string indicatorText, Native.PointStruct firstPoint) {
        this.window = window;
        this.element = element;
        this.limitMs = limitMs;
        this.indicatorText = indicatorText;
        this.firstPoint = firstPoint;
        var random = new Random();
        tag = new IntPtr(unchecked((long)0x4F52474C00000000L | (uint)random.Next(1, int.MaxValue)));
      }

      public void Stop(string reason) {
        if (Interlocked.CompareExchange<string>(ref stoppedBy, reason, null) == null) Interlocked.Exchange(ref stoppedAtTicks, clock.ElapsedTicks);
      }

      string Stopped { get { return Volatile.Read(ref stoppedBy); } }

      // The hooks run on the notice's thread, which pumps its messages; each answers at once.
      IntPtr OnMouse(int code, IntPtr wParam, IntPtr lParam) {
        if (code >= 0) {
          var data = (Native.MouseHookData)Marshal.PtrToStructure(lParam, typeof(Native.MouseHookData));
          if (data.ExtraInfo != tag) {
            var message = wParam.ToInt32();
            var release = message == LeftButtonUp || message == RightButtonUp || message == MiddleButtonUp || message == ExtraButtonUp;
            if (message == MouseMoveMessage) {
              Native.PointStruct now;
              Native.GetCursorPos(out now);
              if (now.X != data.Point.X || now.Y != data.Point.Y) Stop("person_mouse");
            } else if (!release) {
              Stop("person_mouse");
            }
          }
        }
        return Native.CallNextHookEx(IntPtr.Zero, code, wParam, lParam);
      }

      IntPtr OnKeyboard(int code, IntPtr wParam, IntPtr lParam) {
        if (code >= 0) {
          var data = (Native.KeyboardHookData)Marshal.PtrToStructure(lParam, typeof(Native.KeyboardHookData));
          if (data.ExtraInfo != tag) {
            var message = wParam.ToInt32();
            var down = message == KeyDown || message == SystemKeyDown;
            // Escape is how the person stops a borrow, so the app never gets it; a key released from before is not new input.
            if (data.VirtualKey == EscapeKey) {
              if (down) Stop("escape");
              return new IntPtr(1);
            }
            if (down) Stop("person_key");
          }
        }
        return Native.CallNextHookEx(IntPtr.Zero, code, wParam, lParam);
      }

      void RunOverlay(Rectangle area) {
        IntPtr mouseHook = IntPtr.Zero;
        IntPtr keyboardHook = IntPtr.Zero;
        try {
          mouseProcedure = OnMouse;
          keyboardProcedure = OnKeyboard;
          var module = Native.GetModuleHandle(null);
          mouseHook = Native.SetWindowsHookEx(Native.MouseLowLevel, mouseProcedure, module, 0);
          keyboardHook = Native.SetWindowsHookEx(Native.KeyboardLowLevel, keyboardProcedure, module, 0);
          hooked = mouseHook != IntPtr.Zero && keyboardHook != IntPtr.Zero;
          if (!hooked) {
            overlayReady.Set();
            return;
          }
          // A handle on this thread to post the end to. The hooks need this thread's message loop either way; the notice
          // is shown only when the core asks for it, which it does when Orglet's own glow and pill cannot show.
          anchor = new Control();
          anchor.CreateControl();
          if (indicatorText.Length > 0) {
            indicator = new Indicator(indicatorText, area, firstPoint);
            indicator.Show();
          }
          overlayReady.Set();
          Application.Run();
        } catch (Exception error) {
          overlayFailure = error;
          overlayReady.Set();
        } finally {
          if (mouseHook != IntPtr.Zero) Native.UnhookWindowsHookEx(mouseHook);
          if (keyboardHook != IntPtr.Zero) Native.UnhookWindowsHookEx(keyboardHook);
        }
      }

      void CloseOverlay() {
        var posted = anchor;
        var shown = indicator;
        try {
          if (posted != null && posted.IsHandleCreated) posted.BeginInvoke((Action)(() => {
            if (shown != null) shown.Close();
            Application.ExitThread();
          }));
        } catch (InvalidOperationException) {
          // The thread has already ended.
        }
        if (overlay != null) overlay.Join(2000);
      }

      /// <summary>Brings a window to the front: the thread joins the front window's input for a moment, as Windows asks.</summary>
      bool BringForward(IntPtr target) {
        if (Native.GetForegroundWindow() == target) return true;
        Native.MessageStruct message;
        Native.PeekMessage(out message, IntPtr.Zero, 0, 0, 0);
        // A tagged move of nothing makes this the process that sent the last input, which Windows lets take the front.
        Send(MouseEvent(0, 0, Native.MouseMove, 0));
        var front = Native.GetForegroundWindow();
        uint ignored;
        var frontThread = front == IntPtr.Zero ? 0 : Native.GetWindowThreadProcessId(front, out ignored);
        var ownThread = Native.GetCurrentThreadId();
        var attached = frontThread != 0 && frontThread != ownThread && Native.AttachThreadInput(ownThread, frontThread, true);
        try {
          Native.BringWindowToTop(target);
          Native.SetForegroundWindow(target);
        } finally {
          if (attached) Native.AttachThreadInput(ownThread, frontThread, false);
        }
        if (WaitForFront(target, 400)) return true;
        // Some windows in front, such as the shell's own input host, cannot be joined; switching the way Alt+Tab does
        // still brings the window forward, and sends no key.
        Native.SwitchToThisWindow(target, true);
        return WaitForFront(target, 800);
      }

      static bool WaitForFront(IntPtr target, int milliseconds) {
        for (var waited = 0; waited < milliseconds; waited += 20) {
          if (Native.GetForegroundWindow() == target) return true;
          Thread.Sleep(20);
        }
        return Native.GetForegroundWindow() == target;
      }

      Native.Input MouseEvent(int x, int y, uint flags, int data) {
        var input = new Native.Input { Type = Native.InputMouse };
        input.Data.Mouse = new Native.MouseInput { X = x, Y = y, MouseData = unchecked((uint)data), Flags = flags, ExtraInfo = tag };
        return input;
      }

      Native.Input KeyEvent(ushort virtualKey, ushort scan, uint flags) {
        var input = new Native.Input { Type = Native.InputKeyboard };
        input.Data.Keyboard = new Native.KeyboardInput { VirtualKey = virtualKey, Scan = scan, Flags = flags, ExtraInfo = tag };
        return input;
      }

      void Send(params Native.Input[] inputs) {
        Native.SendInput((uint)inputs.Length, inputs, Marshal.SizeOf(typeof(Native.Input)));
        Interlocked.Exchange(ref lastInputTicks, clock.ElapsedTicks);
      }

      /// <summary>Checked before every input: nobody stopped it, time is left, and the approved window is still in front.</summary>
      bool MayContinue() {
        if (Stopped != null) return false;
        if (clock.ElapsedMilliseconds > limitMs) { Stop("time_limit"); return false; }
        if (Native.GetForegroundWindow() != window) { Stop("foreground_changed"); return false; }
        return true;
      }

      /// <summary>Whether the keyboard focus is on the approved element or inside it, and never on a password field.</summary>
      bool FocusOnElement() {
        try {
          var focused = AutomationElement.FocusedElement;
          if (focused == null || focused.Current.IsPassword) return false;
          var walker = TreeWalker.RawViewWalker;
          var candidate = focused;
          for (var steps = 0; candidate != null && steps < 40; steps++) {
            if (Automation.Compare(candidate, element)) return true;
            candidate = walker.GetParent(candidate);
          }
        } catch (ElementNotAvailableException) {
          return false;
        }
        return false;
      }

      IntPtr FocusHandle() {
        uint ignored;
        var thread = Native.GetWindowThreadProcessId(window, out ignored);
        var info = new Native.GuiThreadInfo { Size = Marshal.SizeOf(typeof(Native.GuiThreadInfo)) };
        return Native.GetGUIThreadInfo(thread, ref info) ? info.Focus : IntPtr.Zero;
      }

      /// <summary>Puts the keyboard focus on the element for typing, and says whether it is there.</summary>
      bool FocusForTyping() {
        if (FocusOnElement()) return true;
        try {
          element.SetFocus();
        } catch (Exception) {
          return false;
        }
        for (var waited = 0; waited < 500; waited += 25) {
          if (FocusOnElement()) return true;
          Thread.Sleep(25);
        }
        return false;
      }

      /// <summary>Moves the real cursor onto the element and checks nothing else covers that point.</summary>
      bool MoveOntoElement() {
        Native.PointStruct point;
        try {
          if (!Borrowing.PointOf(element, out point)) { Stop("focus_changed"); return false; }
        } catch (ElementNotAvailableException) {
          Stop("focus_changed");
          return false;
        }
        var left = Native.GetSystemMetrics(Native.VirtualScreenLeft);
        var top = Native.GetSystemMetrics(Native.VirtualScreenTop);
        var width = Math.Max(2, Native.GetSystemMetrics(Native.VirtualScreenWidth));
        var height = Math.Max(2, Native.GetSystemMetrics(Native.VirtualScreenHeight));
        var normalizedX = (int)Math.Round((point.X - left) * 65535.0 / (width - 1));
        var normalizedY = (int)Math.Round((point.Y - top) * 65535.0 / (height - 1));
        if (!MayContinue()) return false;
        Send(MouseEvent(normalizedX, normalizedY, Native.MouseMove | Native.MouseAbsolute | Native.MouseVirtualDesk, 0));
        // Windows moves the cursor when it takes the input from its queue, a moment after SendInput returns.
        var arrived = false;
        for (var waited = 0; waited < 300 && !arrived; waited += 10) {
          Native.PointStruct now;
          Native.GetCursorPos(out now);
          arrived = Math.Abs(now.X - point.X) <= 2 && Math.Abs(now.Y - point.Y) <= 2;
          if (!arrived) Thread.Sleep(10);
        }
        if (Stopped != null) return false;
        if (!arrived) { Stop("focus_changed"); return false; }
        var under = Native.WindowFromPoint(point);
        if (under == IntPtr.Zero || Native.GetAncestor(under, Native.RootAncestor) != window) { Stop("focus_changed"); return false; }
        return true;
      }

      bool Click() {
        if (!MoveOntoElement()) return false;
        if (!MayContinue()) return false;
        Send(MouseEvent(0, 0, Native.MouseLeftDown, 0));
        Thread.Sleep(15);
        // The button always comes back up, even when the person moved in between.
        Send(MouseEvent(0, 0, Native.MouseLeftUp, 0));
        Thread.Sleep(60);
        return Stopped == null;
      }

      bool Scroll(int notches) {
        if (!MoveOntoElement()) return false;
        var direction = notches > 0 ? -1 : 1;
        for (var turned = 0; turned < Math.Abs(notches); turned++) {
          if (!MayContinue()) return false;
          Send(MouseEvent(0, 0, Native.MouseWheel, direction * Native.WheelDelta));
          Thread.Sleep(30);
        }
        return true;
      }

      bool TypeText(string text) {
        if (!FocusForTyping()) { Stop("focus_changed"); return false; }
        var focus = FocusHandle();
        foreach (var character in text) {
          if (!MayContinue()) return false;
          if (FocusHandle() != focus) { Stop("focus_changed"); return false; }
          if (character == '\r') continue;
          if (character == '\n') {
            Send(KeyEvent(0x0D, 0, 0), KeyEvent(0x0D, 0, Native.KeyUp));
          } else if (character == '\t') {
            Send(KeyEvent(0x09, 0, 0), KeyEvent(0x09, 0, Native.KeyUp));
          } else {
            Send(KeyEvent(0, character, Native.KeyUnicode), KeyEvent(0, character, Native.KeyUnicode | Native.KeyUp));
          }
          Thread.Sleep(1);
        }
        return true;
      }

      static readonly Dictionary<string, ushort> NamedKeys = new Dictionary<string, ushort> {
        { "Enter", 0x0D }, { "Tab", 0x09 }, { "Backspace", 0x08 }, { "Delete", 0x2E }, { "Space", 0x20 }, { "Home", 0x24 }, { "End", 0x23 },
        { "PageUp", 0x21 }, { "PageDown", 0x22 }, { "Up", 0x26 }, { "Down", 0x28 }, { "Left", 0x25 }, { "Right", 0x27 },
      };
      static readonly HashSet<ushort> ExtendedKeys = new HashSet<ushort> { 0x2E, 0x24, 0x23, 0x21, 0x22, 0x26, 0x28, 0x25, 0x27 };

      bool PressKeys(object[] names) {
        if (!FocusForTyping()) { Stop("focus_changed"); return false; }
        var focus = FocusHandle();
        foreach (var item in names) {
          var name = Convert.ToString(item);
          var control = name.StartsWith("Ctrl+");
          ushort key;
          if (!NamedKeys.TryGetValue(control ? name.Substring(5) : name, out key)) throw new ArgumentException("unknown key " + name);
          if (!MayContinue()) return false;
          if (FocusHandle() != focus) { Stop("focus_changed"); return false; }
          var flags = ExtendedKeys.Contains(key) ? Native.KeyExtended : 0;
          if (control) {
            Send(KeyEvent(0x11, 0, 0), KeyEvent(key, 0, flags), KeyEvent(key, 0, flags | Native.KeyUp), KeyEvent(0x11, 0, Native.KeyUp));
          } else {
            Send(KeyEvent(key, 0, flags), KeyEvent(key, 0, flags | Native.KeyUp));
          }
          Thread.Sleep(20);
        }
        return true;
      }

      public Dictionary<string, object> Run(List<Dictionary<string, object>> steps) {
        Native.PointStruct cursorBefore;
        Native.GetCursorPos(out cursorBefore);
        var foregroundBefore = Native.GetForegroundWindow();
        var area = Screen.FromHandle(window).WorkingArea;
        clock.Start();
        overlay = new Thread(() => RunOverlay(area));
        overlay.IsBackground = true;
        overlay.SetApartmentState(ApartmentState.STA);
        // The hooks sit on every input on this desktop, so their thread answers first even in a below-normal process.
        overlay.Priority = ThreadPriority.Highest;
        overlay.Start();
        var completed = 0;
        Exception failure = null;
        try {
          // Without the hooks the person could not stop it, so nothing is sent at all.
          if (!overlayReady.WaitOne(3000) || overlayFailure != null || !hooked) throw new InvalidOperationException("borrow_not_watched");
          if (!BringForward(window)) Stop("no_foreground");
          foreach (var step in steps) {
            if (Stopped != null) break;
            var kind = Convert.ToString(step["kind"]);
            bool finished;
            if (kind == "click") finished = Click();
            else if (kind == "type") finished = TypeText(Convert.ToString(step["text"]));
            else if (kind == "keys") finished = PressKeys((object[])step["keys"]);
            else if (kind == "scroll") finished = Scroll(Convert.ToInt32(step["notches"]));
            else throw new ArgumentException("unknown borrow step " + kind);
            if (!finished) break;
            completed++;
          }
        } catch (ElementNotAvailableException) {
          Stop("focus_changed");
        } catch (Exception error) {
          failure = error;
          Stop("run_stopped");
        } finally {
          CloseOverlay();
        }
        if (failure != null && completed == 0 && Interlocked.Read(ref lastInputTicks) < 0) throw failure;
        var reason = Stopped;
        // The person took over with the mouse: the cursor stays where they put it. The window they had in front comes
        // back unless they already brought another one forward themselves; a key they pressed went to the borrowed
        // window, so giving the front back is what lets them go on typing where they were.
        var personMoved = reason == "person_mouse";
        var foregroundRestored = false;
        var frontNow = Native.GetForegroundWindow();
        uint frontProcess;
        uint windowProcess;
        Native.GetWindowThreadProcessId(frontNow, out frontProcess);
        Native.GetWindowThreadProcessId(window, out windowProcess);
        var frontIsOurs = frontNow == IntPtr.Zero || frontNow == window || frontProcess == windowProcess;
        if (foregroundBefore != IntPtr.Zero && Native.IsWindow(foregroundBefore)) {
          if (frontIsOurs) foregroundRestored = BringForward(foregroundBefore);
          else foregroundRestored = frontNow == foregroundBefore;
        }
        var cursorRestored = false;
        if (!personMoved) {
          Native.SetCursorPos(cursorBefore.X, cursorBefore.Y);
          Native.PointStruct cursorAfter;
          Native.GetCursorPos(out cursorAfter);
          cursorRestored = cursorAfter.X == cursorBefore.X && cursorAfter.Y == cursorBefore.Y;
        }
        clock.Stop();
        long latency = -1;
        var stoppedAt = Interlocked.Read(ref stoppedAtTicks);
        var personStopped = reason == "person_mouse" || reason == "person_key" || reason == "escape";
        if (personStopped && stoppedAt >= 0) {
          var lastInput = Interlocked.Read(ref lastInputTicks);
          latency = Math.Max(0, (lastInput - stoppedAt) * 1000 / Stopwatch.Frequency);
        }
        return new Dictionary<string, object> {
          { "completedSteps", completed }, { "stoppedBy", reason }, { "durationMs", clock.ElapsedMilliseconds },
          { "stopLatencyMs", latency >= 0 ? (object)latency : null },
          { "restored", new Dictionary<string, object> { { "foreground", foregroundRestored }, { "cursor", cursorRestored } } },
        };
      }
    }

    // ----- Pictures -----

    /// <summary>
    /// A picture of the window through PrintWindow with full content, which draws it off screen without bringing it forward.
    /// A minimized window has nothing to draw, and restoring it would change the person's screen, so it is refused.
    /// </summary>
    static object Screenshot(Dictionary<string, object> request) {
      WindowFacts facts;
      string problem;
      var window = GrantedWindow(request, out facts, out problem);
      if (window == null) return Problem(problem);
      var handle = new IntPtr(facts.Handle);
      if (Native.IsIconic(handle)) return Problem("minimized");
      Native.Rect bounds;
      if (!Native.GetWindowRect(handle, out bounds)) return Problem("not_possible");
      var width = bounds.Right - bounds.Left;
      var height = bounds.Bottom - bounds.Top;
      if (width <= 0 || height <= 0 || width > 8000 || height > 8000) return Problem("not_possible");
      using (var bitmap = new Bitmap(width, height, PixelFormat.Format32bppArgb)) {
        using (var graphics = Graphics.FromImage(bitmap)) {
          var deviceContext = graphics.GetHdc();
          var printed = Native.PrintWindow(handle, deviceContext, Native.RenderFullContent);
          graphics.ReleaseHdc(deviceContext);
          if (!printed) return Problem("not_possible");
          object highlight;
          if (request.TryGetValue("highlight", out highlight) && highlight != null) {
            var element = RefElement(new Dictionary<string, object> { { "runId", request["runId"] }, { "handle", request["handle"] }, { "ref", highlight } });
            if (element != null) {
              try {
                var box = element.Current.BoundingRectangle;
                if (!box.IsEmpty) {
                  using (var pen = new Pen(Color.FromArgb(230, 220, 38, 38), 3)) {
                    graphics.DrawRectangle(pen, (float)(box.X - bounds.Left - 2), (float)(box.Y - bounds.Top - 2), (float)box.Width + 4, (float)box.Height + 4);
                  }
                }
              } catch (ElementNotAvailableException) {
                // The picture is still useful without the outline.
              }
            }
          }
        }
        // The window rectangle includes the invisible resize border, which draws black; keep only the visible frame.
        var visible = VisibleFrame(handle, bounds);
        using (var cropped = bitmap.Clone(visible, bitmap.PixelFormat))
        using (var stream = new MemoryStream()) {
          cropped.Save(stream, ImageFormat.Png);
          var result = WindowView(facts);
          result["png"] = Convert.ToBase64String(stream.ToArray());
          result["width"] = visible.Width;
          result["height"] = visible.Height;
          return result;
        }
      }
    }

    /// <summary>The part of the window rectangle DWM draws, relative to that rectangle; all of it when DWM does not say.</summary>
    static Rectangle VisibleFrame(IntPtr handle, Native.Rect bounds) {
      var whole = new Rectangle(0, 0, bounds.Right - bounds.Left, bounds.Bottom - bounds.Top);
      Native.Rect frame;
      if (Native.DwmGetWindowAttribute(handle, Native.DwmExtendedFrameBounds, out frame, Marshal.SizeOf(typeof(Native.Rect))) != 0) return whole;
      var visible = Rectangle.Intersect(whole, new Rectangle(frame.Left - bounds.Left, frame.Top - bounds.Top, frame.Right - frame.Left, frame.Bottom - frame.Top));
      return visible.Width > 0 && visible.Height > 0 ? visible : whole;
    }
  }
}
'@
[OrgletDesktop.Host]::Run()
