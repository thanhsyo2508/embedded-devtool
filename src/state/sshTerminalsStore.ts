import { create } from 'zustand'
import { closeNetworkStream, openSsh } from '../api/network'

export interface SshConnectionConfig {
  host: string
  port: number
  username: string
  password: string
}

/** One terminal-dock column (same VSCode-style "editor group" idea as
 * `SftpEditorGroup`, applied to terminals instead of files). The tab's own
 * default terminal (id === the SSH tab's own id) always starts in
 * `groups[0]` and can be dragged/split into the second group like any
 * extra terminal — but it can never be *closed* through this store (that
 * would kill the tab's underlying connection without going through
 * tabsStore's own close/disconnect flow); closing a group that contains it
 * relocates it into whatever group remains instead. */
export interface TerminalGroup {
  id: string
  terminalIds: string[]
  activeTerminalId: string | null
}

const INITIAL_GROUP_ID = 'term-group-1'

function initialGroups(tabId: string): TerminalGroup[] {
  return [{ id: INITIAL_GROUP_ID, terminalIds: [tabId], activeTerminalId: tabId }]
}

/** Extra terminals (and the groups they're arranged into) within one SSH
 * tab. Each extra terminal is its own independent SSH connection — same
 * host/port/username/password as the tab's own, but a separate handshake —
 * rather than a second channel on the tab's existing `SshStream`, which
 * never exposes its `russh` session outside the worker thread that owns
 * the primary PTY (see `core::ssh_stream`'s module doc). Same tradeoff
 * already made for the SFTP sidebar's own connection. A tab that never
 * opens an extra terminal or splits its dock never touches this store at
 * all, so it behaves identically to before this existed. */
interface SshTerminalsState {
  groups: Record<string, TerminalGroup[]>
  activeGroupId: Record<string, string>
  connecting: Record<string, boolean>
  errors: Record<string, string | null>
  // Display number ("Terminal 2", "Terminal 3", ...) assigned once when a
  // terminal is created and never recomputed afterward — deliberately NOT
  // derived from a terminal's index within its current group's
  // terminalIds, since that position changes whenever it's moved or split
  // into a different group, which would silently relabel it (e.g. a lone
  // terminal split into its own new group is always index 0 there, so a
  // position-derived label would call it "Terminal 1" regardless of what
  // it was called before).
  terminalNumbers: Record<string, number>
  nextTerminalNumber: Record<string, number>

  addTerminal: (tabId: string, config: SshConnectionConfig, groupId?: string) => Promise<void>
  closeTerminal: (tabId: string, groupId: string, terminalId: string) => Promise<void>
  setActiveTerminal: (tabId: string, groupId: string, terminalId: string) => void
  setActiveGroup: (tabId: string, groupId: string) => void
  splitGroupRight: (tabId: string, terminalId: string) => void
  moveTerminalToGroup: (
    tabId: string,
    terminalId: string,
    fromGroupId: string,
    toGroupId: string,
  ) => void
  closeGroup: (tabId: string, groupId: string) => Promise<void>
  disposeSession: (tabId: string) => Promise<void>
}

export const useSshTerminalsStore = create<SshTerminalsState>((set, get) => ({
  groups: {},
  activeGroupId: {},
  connecting: {},
  errors: {},
  terminalNumbers: {},
  nextTerminalNumber: {},

  addTerminal: async (tabId, config, groupId) => {
    const groups = get().groups[tabId] ?? initialGroups(tabId)
    const targetGroupId = groupId ?? get().activeGroupId[tabId] ?? groups[0].id
    const terminalId = `${tabId}::term-${Date.now()}`
    // The primary terminal is unnumbered ("Terminal"), so the first extra
    // one is "Terminal 2".
    const number = get().nextTerminalNumber[tabId] ?? 2
    const nextGroups = groups.map((g) =>
      g.id === targetGroupId
        ? { ...g, terminalIds: [...g.terminalIds, terminalId], activeTerminalId: terminalId }
        : g,
    )
    set((state) => ({
      groups: { ...state.groups, [tabId]: nextGroups },
      activeGroupId: { ...state.activeGroupId, [tabId]: targetGroupId },
      connecting: { ...state.connecting, [terminalId]: true },
      errors: { ...state.errors, [terminalId]: null },
      terminalNumbers: { ...state.terminalNumbers, [terminalId]: number },
      nextTerminalNumber: { ...state.nextTerminalNumber, [tabId]: number + 1 },
    }))
    try {
      await openSsh(terminalId, config.host, config.port, config.username, config.password)
      set((state) => ({ connecting: { ...state.connecting, [terminalId]: false } }))
    } catch (err) {
      set((state) => ({
        connecting: { ...state.connecting, [terminalId]: false },
        errors: { ...state.errors, [terminalId]: String(err) },
      }))
    }
  },

  closeTerminal: async (tabId, groupId, terminalId) => {
    // The tab's own primary terminal is never closed through this path —
    // see the module doc. The UI never offers a close button for it, this
    // is just a defensive backstop.
    if (terminalId === tabId) return
    await closeNetworkStream(terminalId).catch(() => {})
    const groups = get().groups[tabId] ?? initialGroups(tabId)
    const nextGroups = groups.map((g) => {
      if (g.id !== groupId) return g
      const terminalIds = g.terminalIds.filter((id) => id !== terminalId)
      const activeTerminalId =
        g.activeTerminalId === terminalId
          ? (terminalIds[terminalIds.length - 1] ?? null)
          : g.activeTerminalId
      return { ...g, terminalIds, activeTerminalId }
    })
    set((state) => {
      const connecting = { ...state.connecting }
      delete connecting[terminalId]
      const errors = { ...state.errors }
      delete errors[terminalId]
      const terminalNumbers = { ...state.terminalNumbers }
      delete terminalNumbers[terminalId]
      return {
        groups: { ...state.groups, [tabId]: nextGroups },
        connecting,
        errors,
        terminalNumbers,
      }
    })
  },

  setActiveTerminal: (tabId, groupId, terminalId) => {
    const groups = get().groups[tabId] ?? initialGroups(tabId)
    const nextGroups = groups.map((g) =>
      g.id === groupId ? { ...g, activeTerminalId: terminalId } : g,
    )
    set((state) => ({
      groups: { ...state.groups, [tabId]: nextGroups },
      activeGroupId: { ...state.activeGroupId, [tabId]: groupId },
    }))
  },

  setActiveGroup: (tabId, groupId) => {
    set((state) => ({ activeGroupId: { ...state.activeGroupId, [tabId]: groupId } }))
  },

  /** VSCode-style "Split Right" — capped at two groups for v1, mirroring
   * `sftpStore`'s `splitGroupRight` exactly. */
  splitGroupRight: (tabId, terminalId) => {
    const groups = get().groups[tabId] ?? initialGroups(tabId)
    const [first, second] = groups
    // Splitting *moves* the terminal into the new/second group — it must
    // not stay referenced in `first` too, or the same terminal ends up
    // shown as a tab in both groups at once.
    const firstTerminalIds = first.terminalIds.filter((id) => id !== terminalId)
    const firstActiveTerminalId =
      first.activeTerminalId === terminalId
        ? (firstTerminalIds[firstTerminalIds.length - 1] ?? null)
        : first.activeTerminalId
    const updatedFirst: TerminalGroup = {
      ...first,
      terminalIds: firstTerminalIds,
      activeTerminalId: firstActiveTerminalId,
    }
    let nextGroups: TerminalGroup[]
    let nextActiveGroupId: string
    if (second) {
      const terminalIds = second.terminalIds.includes(terminalId)
        ? second.terminalIds
        : [...second.terminalIds, terminalId]
      nextGroups = [updatedFirst, { ...second, terminalIds, activeTerminalId: terminalId }]
      nextActiveGroupId = second.id
    } else {
      const newGroup: TerminalGroup = {
        id: `term-group-${Date.now()}`,
        terminalIds: [terminalId],
        activeTerminalId: terminalId,
      }
      nextGroups = [updatedFirst, newGroup]
      nextActiveGroupId = newGroup.id
    }
    set((state) => ({
      groups: { ...state.groups, [tabId]: nextGroups },
      activeGroupId: { ...state.activeGroupId, [tabId]: nextActiveGroupId },
    }))
  },

  moveTerminalToGroup: (tabId, terminalId, fromGroupId, toGroupId) => {
    if (fromGroupId === toGroupId) return
    const groups = get().groups[tabId] ?? initialGroups(tabId)
    const nextGroups = groups.map((g) => {
      if (g.id === fromGroupId) {
        const terminalIds = g.terminalIds.filter((id) => id !== terminalId)
        const activeTerminalId =
          g.activeTerminalId === terminalId
            ? (terminalIds[terminalIds.length - 1] ?? null)
            : g.activeTerminalId
        return { ...g, terminalIds, activeTerminalId }
      }
      if (g.id === toGroupId) {
        const terminalIds = g.terminalIds.includes(terminalId)
          ? g.terminalIds
          : [...g.terminalIds, terminalId]
        return { ...g, terminalIds, activeTerminalId: terminalId }
      }
      return g
    })
    set((state) => ({
      groups: { ...state.groups, [tabId]: nextGroups },
      activeGroupId: { ...state.activeGroupId, [tabId]: toGroupId },
    }))
  },

  closeGroup: async (tabId, groupId) => {
    const groups = get().groups[tabId] ?? initialGroups(tabId)
    if (groups.length <= 1) return
    const closing = groups.find((g) => g.id === groupId)
    if (!closing) return
    const remaining = groups.filter((g) => g.id !== groupId)
    // Extra terminals in the closing group are genuinely closed; the tab's
    // own primary terminal, if it was here, is preserved by relocating it
    // into whatever group remains — see the module doc.
    const extrasToClose = closing.terminalIds.filter((id) => id !== tabId)
    await Promise.all(extrasToClose.map((id) => closeNetworkStream(id).catch(() => {})))
    let nextGroups = remaining
    if (closing.terminalIds.includes(tabId)) {
      nextGroups = remaining.map((g, i) =>
        i === 0
          ? {
              ...g,
              terminalIds: g.terminalIds.includes(tabId)
                ? g.terminalIds
                : [...g.terminalIds, tabId],
              activeTerminalId: tabId,
            }
          : g,
      )
    }
    set((state) => {
      const connecting = { ...state.connecting }
      const errors = { ...state.errors }
      const terminalNumbers = { ...state.terminalNumbers }
      for (const id of extrasToClose) {
        delete connecting[id]
        delete errors[id]
        delete terminalNumbers[id]
      }
      return {
        groups: { ...state.groups, [tabId]: nextGroups },
        activeGroupId: { ...state.activeGroupId, [tabId]: nextGroups[0].id },
        connecting,
        errors,
        terminalNumbers,
      }
    })
  },

  disposeSession: async (tabId) => {
    const groups = get().groups[tabId] ?? []
    const extraIds = groups.flatMap((g) => g.terminalIds).filter((id) => id !== tabId)
    await Promise.all(extraIds.map((id) => closeNetworkStream(id).catch(() => {})))
    set((state) => {
      const groupsNext = { ...state.groups }
      delete groupsNext[tabId]
      const activeGroupIdNext = { ...state.activeGroupId }
      delete activeGroupIdNext[tabId]
      const nextTerminalNumberNext = { ...state.nextTerminalNumber }
      delete nextTerminalNumberNext[tabId]
      const connecting = { ...state.connecting }
      const errors = { ...state.errors }
      const terminalNumbers = { ...state.terminalNumbers }
      for (const id of extraIds) {
        delete connecting[id]
        delete errors[id]
        delete terminalNumbers[id]
      }
      return {
        groups: groupsNext,
        activeGroupId: activeGroupIdNext,
        nextTerminalNumber: nextTerminalNumberNext,
        connecting,
        errors,
        terminalNumbers,
      }
    })
  },
}))

export function fallbackTerminalGroups(tabId: string): TerminalGroup[] {
  return initialGroups(tabId)
}
