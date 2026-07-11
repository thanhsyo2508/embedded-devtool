import type { SVGProps } from 'react'

function Icon({ children, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      {children}
    </svg>
  )
}

export function PlugIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M9 3v5M15 3v5" />
      <rect x="6" y="8" width="12" height="7" rx="2" />
      <path d="M12 15v3a4 4 0 0 0 4 4h1" />
    </Icon>
  )
}

export function UsbIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <rect x="3" y="9" width="7" height="6" rx="1.5" />
      <path d="M10 12h4M14 8h3a2 2 0 0 1 2 2v1M14 16h3a2 2 0 0 0 2-2v-1M19 6.5v3M19 14.5v3" />
    </Icon>
  )
}

export function RefreshIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M20 11a8 8 0 0 0-14.9-3.5M4 13a8 8 0 0 0 14.9 3.5" />
      <path d="M5 4v4h4M19 20v-4h-4" />
    </Icon>
  )
}

export function GaugeIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M4 14a8 8 0 1 1 16 0" />
      <path d="M12 14l3.5-4" />
      <path d="M12 17v.01" />
    </Icon>
  )
}

export function RepeatIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M17 2l4 4-4 4" />
      <path d="M3 12v-2a4 4 0 0 1 4-4h14" />
      <path d="M7 22l-4-4 4-4" />
      <path d="M21 12v2a4 4 0 0 1-4 4H3" />
    </Icon>
  )
}

export function DiskIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M4 4h13l3 3v13a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z" />
      <path d="M7 4v5h9V4" />
      <path d="M7 20v-6h10v6" />
    </Icon>
  )
}

export function GearIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1.08-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1.08 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </Icon>
  )
}

export function XIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M18 6 6 18M6 6l12 12" />
    </Icon>
  )
}

export function ZapIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M13 2 4 14h6l-1 8 9-12h-6l1-8z" />
    </Icon>
  )
}

export function FolderIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M3 6a1 1 0 0 1 1-1h5l2 2h9a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z" />
    </Icon>
  )
}

export function TrashIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M4 7h16M9 7V4h6v3M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13" />
    </Icon>
  )
}

export function PlusIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M12 5v14M5 12h14" />
    </Icon>
  )
}

export function ChartIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M4 19V5M4 19h16" />
      <path d="M8 15l3-4 3 2 4-6" />
    </Icon>
  )
}

export function ChipIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <rect x="7" y="7" width="10" height="10" rx="1.5" />
      <path d="M9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3" />
    </Icon>
  )
}

export function MessageIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M21 12a8 8 0 0 1-8 8H5l-2 2v-2.5A8 8 0 1 1 21 12z" />
    </Icon>
  )
}

export function FilterIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M4 5h16l-6 8v6l-4 2v-8z" />
    </Icon>
  )
}

export function BookmarkIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M6 3h12v18l-6-4-6 4z" />
    </Icon>
  )
}

export function SearchIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21l-4.3-4.3" />
    </Icon>
  )
}

export function CircleIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="8" fill="currentColor" stroke="none" />
    </Icon>
  )
}

export function PlayIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M7 4l13 8-13 8z" fill="currentColor" stroke="none" />
    </Icon>
  )
}

export function TargetIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="8" />
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
    </Icon>
  )
}

export function CodeIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M8 6 2 12l6 6M16 6l6 6-6 6" />
    </Icon>
  )
}

export function StopIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <rect x="6" y="6" width="12" height="12" rx="1.5" fill="currentColor" stroke="none" />
    </Icon>
  )
}

export function BookOpenIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M12 6c-2-2-5-2-8-2v14c3 0 6 0 8 2V6z" />
      <path d="M12 6c2-2 5-2 8-2v14c-3 0-6 0-8 2V6z" />
    </Icon>
  )
}

export function GlobeIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3a14 14 0 0 1 0 18a14 14 0 0 1 0-18z" />
    </Icon>
  )
}

export function CopyIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <rect x="9" y="9" width="12" height="12" rx="1.5" />
      <path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1" />
    </Icon>
  )
}

export function MagicWandIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M4 20 15 9" />
      <path d="M14 4v3M19 9h3M18 3l1 1M21 5l-1 1" />
      <path d="M6 12v3M4.5 13.5h3" />
    </Icon>
  )
}
