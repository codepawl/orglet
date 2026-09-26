# Plays the person during a borrow test (COD-261, phase 2b): after a delay, it sends one input of its own, without
# Orglet's tag, the way a person's hand on the mouse or keyboard would arrive. `mouse` moves the cursor well clear of
# wherever Orglet aimed it (48 px down and right, so it is never mistaken for Orglet's own echo, which lands at the
# element); `escape` presses and releases Escape. It prints the time it sent the input, in milliseconds since 1970.
param([int]$DelayMs = 800, [ValidateSet('mouse', 'escape')][string]$Kind = 'mouse')

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class Nudge {
  [StructLayout(LayoutKind.Sequential)] struct MouseInput { public int X; public int Y; public uint MouseData; public uint Flags; public uint Time; public IntPtr ExtraInfo; }
  [StructLayout(LayoutKind.Sequential)] struct KeyboardInput { public ushort VirtualKey; public ushort Scan; public uint Flags; public uint Time; public IntPtr ExtraInfo; }
  [StructLayout(LayoutKind.Explicit)] struct InputUnion { [FieldOffset(0)] public MouseInput Mouse; [FieldOffset(0)] public KeyboardInput Keyboard; }
  [StructLayout(LayoutKind.Sequential)] struct Input { public uint Type; public InputUnion Data; }
  [DllImport("user32.dll")] static extern uint SendInput(uint count, Input[] inputs, int size);

  public static void Mouse() {
    var input = new Input { Type = 0 };
    input.Data.Mouse = new MouseInput { X = 48, Y = 48, Flags = 0x0001 };
    SendInput(1, new[] { input }, Marshal.SizeOf(typeof(Input)));
  }

  public static void Escape() {
    var down = new Input { Type = 1 };
    down.Data.Keyboard = new KeyboardInput { VirtualKey = 0x1B };
    var up = new Input { Type = 1 };
    up.Data.Keyboard = new KeyboardInput { VirtualKey = 0x1B, Flags = 0x0002 };
    SendInput(2, new[] { down, up }, Marshal.SizeOf(typeof(Input)));
  }
}
'@

Start-Sleep -Milliseconds $DelayMs
if ($Kind -eq 'mouse') { [Nudge]::Mouse() } else { [Nudge]::Escape() }
[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
