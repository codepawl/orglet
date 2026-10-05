/**
 * Shell completion for `orglet`: the command names first, then option names. The scripts are static text, so
 * completing asks the app nothing and names no orglet, chat or space.
 */

export const COMPLETION_SHELLS = ['powershell', 'bash', 'zsh'] as const;
export type CompletionShell = typeof COMPLETION_SHELLS[number];

function powershellScript(commands: readonly string[], options: readonly string[]): string {
  const quoted = (words: readonly string[]) => words.map(word => `'${word}'`).join(', ');
  return [
    '# orglet completion for PowerShell. Add this line to your $PROFILE:',
    '#   orglet completion powershell | Out-String | Invoke-Expression',
    'Register-ArgumentCompleter -Native -CommandName orglet -ScriptBlock {',
    '  param($wordToComplete, $commandAst, $cursorPosition)',
    `  $commands = @(${quoted(commands)})`,
    `  $options = @(${quoted(options)})`,
    '  $typed = @($commandAst.CommandElements | ForEach-Object { $_.ToString() })',
    '  $position = $typed.Count',
    '  if ($wordToComplete) { $position = $typed.Count - 1 }',
    "  $words = if ($wordToComplete.StartsWith('-')) { $options } elseif ($position -le 1) { $commands } else { @() }",
    '  $words | Where-Object { $_ -like "$wordToComplete*" } | ForEach-Object {',
    "    [System.Management.Automation.CompletionResult]::new($_, $_, 'ParameterValue', $_)",
    '  }',
    '}',
  ].join('\n');
}

function bashScript(commands: readonly string[], options: readonly string[]): string {
  return [
    '# orglet completion for bash. Add this line to your ~/.bashrc:',
    '#   eval "$(orglet completion bash)"',
    '_orglet_completion() {',
    '  local current="${COMP_WORDS[COMP_CWORD]}"',
    `  local commands="${commands.join(' ')}"`,
    `  local options="${options.join(' ')}"`,
    '  if [[ "$current" == -* ]]; then',
    '    COMPREPLY=($(compgen -W "$options" -- "$current"))',
    '  elif [[ $COMP_CWORD -eq 1 ]]; then',
    '    COMPREPLY=($(compgen -W "$commands" -- "$current"))',
    '  else',
    '    COMPREPLY=()',
    '  fi',
    '}',
    'complete -o default -F _orglet_completion orglet',
  ].join('\n');
}

function zshScript(commands: readonly string[], options: readonly string[]): string {
  return [
    '# orglet completion for zsh. Add this line to your ~/.zshrc, after compinit:',
    '#   eval "$(orglet completion zsh)"',
    '_orglet() {',
    `  local -a commands=(${commands.join(' ')})`,
    `  local -a options=(${options.join(' ')})`,
    '  if [[ "${words[CURRENT]}" == -* ]]; then',
    '    compadd -a options',
    '  elif (( CURRENT == 2 )); then',
    '    compadd -a commands',
    '  else',
    '    _files',
    '  fi',
    '}',
    'compdef _orglet orglet',
  ].join('\n');
}

export function completionScript(shell: CompletionShell, commands: readonly string[], options: readonly string[]): string {
  if (shell === 'powershell') return powershellScript(commands, options);
  if (shell === 'bash') return bashScript(commands, options);
  return zshScript(commands, options);
}
