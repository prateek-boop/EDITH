import type { FileNode } from './types'

export function fileNameError(name: string, parent: string, files: FileNode[], except?: string): string {
  if (!name.trim()) return 'Enter a name.'
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) return 'This name is reserved by the operating system. Choose another name.'
  if (name.length > 180) return 'Use a name with 180 characters or fewer.'
  if (name === '.' || name === '..' || /[\\/:*?"<>|\u0000-\u001f]/.test(name) || /[. ]$/.test(name)) return 'Use a filename without slashes, reserved characters, or a trailing dot.'
  const path = parent ? `${parent}/${name}` : name
  const exists = (nodes: FileNode[]): boolean => nodes.some(n => (n.path.toLowerCase() === path.toLowerCase() && n.path !== except) || exists(n.children || []))
  return exists(files) ? 'A file or folder with this name already exists here.' : ''
}
