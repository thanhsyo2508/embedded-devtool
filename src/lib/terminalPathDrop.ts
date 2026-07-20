import { writeNetworkStream } from '../api/network'

// Must match SftpTreeSidebar.tsx's own TREE_DRAG_TYPE export — duplicated
// as a literal here (not imported) for the same reason SshWorkspacePanel's
// INTERNAL_DRAG_TYPES comment gives: it's a plain string constant, and a
// components→lib import the other way round would be an odd dependency
// direction for something this small.
const TREE_DRAG_TYPE = 'application/x-sftp-tree-path'

function shellQuote(path: string): string {
  return `'${path.replace(/'/g, "'\\''")}'`
}

/** Shared by SshPanel.tsx and SshExtraTerminal.tsx: dropping a file/folder
 * dragged from the SFTP tree sidebar onto a terminal inserts its
 * single-quoted path at the cursor, as if typed — same convention as
 * dragging a file onto iTerm2/GNOME Terminal/MobaXterm. It does not press
 * Enter, so `cat `, drag, then finish the command by hand still works. */
export function handleTerminalPathDragOver(e: React.DragEvent<HTMLDivElement>): void {
  if (!e.dataTransfer.types.includes(TREE_DRAG_TYPE)) return
  e.preventDefault()
}

export function handleTerminalPathDrop(
  e: React.DragEvent<HTMLDivElement>,
  terminalId: string,
): void {
  if (!e.dataTransfer.types.includes(TREE_DRAG_TYPE)) return
  e.preventDefault()
  const path = e.dataTransfer.getData(TREE_DRAG_TYPE)
  if (!path) return
  void writeNetworkStream(terminalId, Array.from(new TextEncoder().encode(shellQuote(path))))
}
