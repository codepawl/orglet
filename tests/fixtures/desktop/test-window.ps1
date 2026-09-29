# A small WinForms window for the desktop-use tests (COD-261, phase 2a). It opens without taking the foreground, sits
# in the bottom-right corner, and closes itself after the number of seconds given as the first argument (default 120),
# so a failed test never leaves it behind. The buttons only change the status line: nothing is saved or deleted.
# The sketch pad draws itself and offers no UI Automation pattern, so typing into it is only possible with a borrowed
# keyboard (phase 2b); it shows what reached it on its own line.
param([int]$Seconds = 120, [string]$Title = 'Orglet desktop test')

Add-Type -AssemblyName System.Windows.Forms, System.Drawing
Add-Type -ReferencedAssemblies System.Windows.Forms, System.Drawing -TypeDefinition @'
using System.Drawing;
using System.Windows.Forms;
public class QuietForm : Form {
  // Showing the window must not take the keyboard from the app the person is using.
  protected override bool ShowWithoutActivation { get { return true; } }
}
public class SketchPad : Control {
  public string Typed = "";
  public int Clicks;
  public SketchPad() {
    SetStyle(ControlStyles.Selectable | ControlStyles.UserPaint | ControlStyles.AllPaintingInWmPaint, true);
    TabStop = true;
  }
  protected override void OnMouseDown(MouseEventArgs arguments) { Focus(); Clicks++; Invalidate(); base.OnMouseDown(arguments); }
  protected override void OnKeyPress(KeyPressEventArgs arguments) {
    if (arguments.KeyChar == (char)27) Typed += "[esc]";
    else if (arguments.KeyChar == '\r') Typed += "\n";
    else if (arguments.KeyChar >= ' ') Typed += arguments.KeyChar;
    Invalidate();
    base.OnKeyPress(arguments);
  }
  protected override void OnPaint(PaintEventArgs arguments) {
    arguments.Graphics.Clear(Color.White);
    TextRenderer.DrawText(arguments.Graphics, Typed, Font, ClientRectangle, Color.Black, TextFormatFlags.WordBreak);
  }
}
'@

$form = New-Object QuietForm
$form.Text = $Title
$form.Width = 420
$form.Height = 380
$form.StartPosition = 'Manual'
$workingArea = [System.Windows.Forms.Screen]::PrimaryScreen.WorkingArea
$form.Location = New-Object System.Drawing.Point(($workingArea.Right - 440), ($workingArea.Bottom - 400))

$status = New-Object System.Windows.Forms.Label
$status.Text = 'Status: ready'
$status.SetBounds(12, 12, 380, 20)

$note = New-Object System.Windows.Forms.TextBox
$note.AccessibleName = 'Note'
$note.SetBounds(12, 40, 380, 24)

$password = New-Object System.Windows.Forms.TextBox
$password.AccessibleName = 'Password'
$password.UseSystemPasswordChar = $true
$password.SetBounds(12, 72, 380, 24)

$wrap = New-Object System.Windows.Forms.CheckBox
$wrap.Text = 'Wrap lines'
$wrap.SetBounds(12, 104, 200, 24)

$priority = New-Object System.Windows.Forms.ComboBox
$priority.AccessibleName = 'Priority'
$priority.DropDownStyle = 'DropDownList'
[void]$priority.Items.AddRange(@('Low', 'Medium', 'High'))
$priority.SelectedIndex = 0
$priority.SetBounds(12, 136, 200, 24)

$append = New-Object System.Windows.Forms.Button
$append.Text = 'Add line'
$append.SetBounds(12, 176, 110, 30)
$append.Add_Click({ $status.Text = 'Status: added ' + $note.Text })

$save = New-Object System.Windows.Forms.Button
$save.Text = 'Save'
$save.SetBounds(132, 176, 110, 30)
$save.Add_Click({ $status.Text = 'Status: saved ' + $note.Text })

$delete = New-Object System.Windows.Forms.Button
$delete.Text = 'Delete'
$delete.SetBounds(252, 176, 110, 30)
$delete.Add_Click({ $status.Text = 'Status: deleted' })

$sketch = New-Object SketchPad
$sketch.AccessibleName = 'Sketch pad'
$sketch.SetBounds(12, 216, 380, 60)

$sketchState = New-Object System.Windows.Forms.Label
$sketchState.Text = 'Sketch: 0 clicks, ""'
$sketchState.SetBounds(12, 284, 380, 20)
$sketch.Add_Invalidated({ $sketchState.Text = 'Sketch: ' + $sketch.Clicks + ' clicks, "' + $sketch.Typed.Replace("`n", '\n') + '"' })

$form.Controls.AddRange(@($status, $note, $password, $wrap, $priority, $append, $save, $delete, $sketch, $sketchState))
# Save is the form's default button, which Windows marks with the default push button style. Only a native button
# (FlatStyle System) carries that style, and Windows Forms applies it when the form is activated, which this one never
# is, so it is applied once the window shows.
$save.FlatStyle = 'System'
$form.AcceptButton = $save
$form.Add_Shown({ $save.NotifyDefault($true) })

$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = [Math]::Max(1, $Seconds) * 1000
$timer.Add_Tick({ $timer.Stop(); $form.Close() })
$timer.Start()

[System.Windows.Forms.Application]::Run($form)
