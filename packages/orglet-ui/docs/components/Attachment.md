---
name: Attachment
exports: Attachment, fileKind, formatFileSize, FileKind
group: Display
summary: A file as a same-width card with its kind's icon, name and size, plus helpers to read a file's kind and size.
---

## When to use

- A file attached to a message or a composer: a row of same-width cards.
- With `onOpen`, the whole card opens the file. With `onRemove`, a remove button shows on hover or focus.
- `inactive` for a file that can no longer be used, with `meta` saying why.
- `fileKind` to pick an icon from a file name, and `formatFileSize` to write a size in a locale.

## When not to

- A document you are reading at full size: use `Viewer`.
- A command to copy: use `CommandBlock`.
- A plain list of names with no card: write a list.

## Example

```tsx
import { Attachment, fileKind, formatFileSize, type FileKind } from '@codepawlhq/orglet-ui';
import { File, FileImage, X } from 'lucide-react';

const icons: Record<FileKind, JSX.Element> = {
  image: <FileImage size={20} aria-hidden />,
  document: <File size={20} aria-hidden />,
  video: <File size={20} aria-hidden />,
  audio: <File size={20} aria-hidden />,
  spreadsheet: <File size={20} aria-hidden />,
  data: <File size={20} aria-hidden />,
  code: <File size={20} aria-hidden />,
  archive: <File size={20} aria-hidden />,
  text: <File size={20} aria-hidden />,
  file: <File size={20} aria-hidden />,
};

<ul>
  {files.map(file => <Attachment
    key={file.name}
    name={file.name}
    meta={`${fileKind(file.name)}, ${formatFileSize(file.size, 'en')}`}
    icon={icons[fileKind(file.name)]}
    onRemove={() => removeFile(file)}
    removeLabel={`Remove ${file.name}`}
    removeIcon={<X size={14} aria-hidden />}
  />)}
</ul>
```

## Props

### Attachment

It renders a list item. The parent is the list.

| Prop | Type | Default | What it does |
|---|---|---|---|
| `name` | `string` | required | The file's name. Also the card's tooltip. |
| `meta` | `string` | required | A line saying what it is and how big, or why it is inactive. |
| `icon` | `ReactNode` | required | The kind's icon. |
| `onOpen` | `() => void` | | Makes the whole card a button that opens the file. |
| `onRemove` | `() => void` | | Adds a remove button. Needs `removeLabel` and `removeIcon`. |
| `removeLabel` | `string` | | The remove button's accessible name. Required with `onRemove`. |
| `removeIcon` | `ReactNode` | | The remove button's icon. Required with `onRemove`. |
| `inactive` | `boolean` | `false` | Draws a file that can no longer be used quieter. |

### fileKind

`fileKind(name: string): FileKind`. Reads the kind from the extension of `name`, case-insensitive. A name with no extension, or an unknown one, is `'file'`.

### formatFileSize

`formatFileSize(bytes: number, locale?: string): string`. Gives "12 KB" or "1.4 MB": one decimal under ten, whole numbers above, from B to GB.

### FileKind

`'image' | 'video' | 'audio' | 'document' | 'spreadsheet' | 'data' | 'code' | 'archive' | 'text' | 'file'`.

## Accessibility

- With `onOpen` the card is one button, named by its name and meta. Without it the card is a plain list item.
- The remove button keeps its place and shows on hover or visible focus, so nothing shifts when the pointer arrives.
- The kind's icon is decorative and sits left of the text. Say what the file is in `meta`.
- An inactive file says why in `meta`, as text, not only by looking quieter.
