# Orglet's desktop helper (COD-261, phase 2a). Windows PowerShell 5.1 runs it; the core sends it on the first line of
# standard input and then one JSON request per line, and reads one JSON answer per line back.
#
# It reads and acts on windows only through UI Automation patterns (Invoke, Value, Toggle, ExpandCollapse,
# SelectionItem, ScrollItem). It never moves the real cursor, never sends keys or mouse input (no SendInput, no
# PostMessage), and never brings a window to the front. A step UI Automation cannot do in the background comes back as
# "not possible", never as a fallback to real input.
#
# The C# below is compiled in memory by the .NET Framework on this computer; nothing new is installed.

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes, System.Drawing, System.Web.Extensions
Add-Type -ReferencedAssemblies UIAutomationClient, UIAutomationTypes, WindowsBase, System.Drawing, System.Web.Extensions -Language CSharp -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Automation;

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

    public const uint ProcessQueryLimitedInformation = 0x1000;
    public const uint TokenQuery = 0x0008;
    public const int TokenIntegrityLevel = 25;
    public const int DwmCloaked = 14;
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
        result["target"] = new Dictionary<string, object> {
          { "ref", Convert.ToString(request["ref"]) }, { "name", info.Name ?? "" }, { "controlType", Words(info.ControlType.ProgrammaticName) },
          { "automationId", info.AutomationId ?? "" }, { "className", info.ClassName ?? "" }, { "enabled", info.IsEnabled }, { "password", info.IsPassword },
          { "actions", LiveActions(element) }, { "inDialog", dialog }, { "defaultButton", defaultButton }, { "windowName", windowName },
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
        using (var stream = new MemoryStream()) {
          bitmap.Save(stream, ImageFormat.Png);
          var result = WindowView(facts);
          result["png"] = Convert.ToBase64String(stream.ToArray());
          result["width"] = width;
          result["height"] = height;
          return result;
        }
      }
    }
  }
}
'@
[OrgletDesktop.Host]::Run()
