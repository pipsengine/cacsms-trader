export type DashboardTone =
  | 'blue'
  | 'emerald'
  | 'orange'
  | 'purple'
  | 'rose'
  | 'slate'
  | 'violet'
  | 'cyan'
  | 'amber';

/** Moderate tinted card — visible color coding without heavy saturation. */
export function toneCard(tone: DashboardTone) {
  return {
    blue: 'border-blue-200 bg-gradient-to-br from-blue-100 via-blue-50 to-white shadow-md shadow-blue-200/20',
    emerald: 'border-emerald-200 bg-gradient-to-br from-emerald-100 via-emerald-50 to-white shadow-md shadow-emerald-200/20',
    orange: 'border-orange-200 bg-gradient-to-br from-orange-100 via-orange-50 to-white shadow-md shadow-orange-200/20',
    purple: 'border-purple-200 bg-gradient-to-br from-purple-100 via-purple-50 to-white shadow-md shadow-purple-200/20',
    rose: 'border-rose-200 bg-gradient-to-br from-rose-100 via-rose-50 to-white shadow-md shadow-rose-200/20',
    slate: 'border-slate-200 bg-gradient-to-br from-slate-100 via-slate-50 to-white shadow-md shadow-slate-200/20',
    violet: 'border-violet-200 bg-gradient-to-br from-violet-100 via-violet-50 to-white shadow-md shadow-violet-200/20',
    cyan: 'border-cyan-200 bg-gradient-to-br from-cyan-100 via-cyan-50 to-white shadow-md shadow-cyan-200/20',
    amber: 'border-amber-200 bg-gradient-to-br from-amber-100 via-amber-50 to-white shadow-md shadow-amber-200/20',
  }[tone];
}

export function toneCardHeader(tone: DashboardTone) {
  return {
    blue: 'border-blue-200/80 bg-blue-100/70',
    emerald: 'border-emerald-200/80 bg-emerald-100/70',
    orange: 'border-orange-200/80 bg-orange-100/70',
    purple: 'border-purple-200/80 bg-purple-100/70',
    rose: 'border-rose-200/80 bg-rose-100/70',
    slate: 'border-slate-200/80 bg-slate-100/70',
    violet: 'border-violet-200/80 bg-violet-100/70',
    cyan: 'border-cyan-200/80 bg-cyan-100/70',
    amber: 'border-amber-200/80 bg-amber-100/70',
  }[tone];
}

export function toneMetric(tone: DashboardTone) {
  return {
    blue: 'border-blue-200 bg-blue-50',
    emerald: 'border-emerald-200 bg-emerald-50',
    orange: 'border-orange-200 bg-orange-50',
    purple: 'border-purple-200 bg-purple-50',
    rose: 'border-rose-200 bg-rose-50',
    slate: 'border-slate-200 bg-slate-50',
    violet: 'border-violet-200 bg-violet-50',
    cyan: 'border-cyan-200 bg-cyan-50',
    amber: 'border-amber-200 bg-amber-50',
  }[tone];
}

export function toneTitle(tone: DashboardTone) {
  return {
    blue: 'text-blue-950',
    emerald: 'text-emerald-950',
    orange: 'text-orange-950',
    purple: 'text-purple-950',
    rose: 'text-rose-950',
    slate: 'text-slate-900',
    violet: 'text-violet-950',
    cyan: 'text-cyan-950',
    amber: 'text-amber-950',
  }[tone];
}

export function toneBody(tone: DashboardTone) {
  return {
    blue: 'text-blue-900',
    emerald: 'text-emerald-900',
    orange: 'text-orange-900',
    purple: 'text-purple-900',
    rose: 'text-rose-900',
    slate: 'text-slate-800',
    violet: 'text-violet-900',
    cyan: 'text-cyan-900',
    amber: 'text-amber-900',
  }[tone];
}

export function toneMuted(tone: DashboardTone) {
  return {
    blue: 'text-blue-700',
    emerald: 'text-emerald-700',
    orange: 'text-orange-700',
    purple: 'text-purple-700',
    rose: 'text-rose-700',
    slate: 'text-slate-600',
    violet: 'text-violet-700',
    cyan: 'text-cyan-700',
    amber: 'text-amber-700',
  }[tone];
}

export function toneInsetSurface(tone: DashboardTone) {
  return {
    blue: 'border-blue-200/80 bg-white/80',
    emerald: 'border-emerald-200/80 bg-white/80',
    orange: 'border-orange-200/80 bg-white/80',
    purple: 'border-purple-200/80 bg-white/80',
    rose: 'border-rose-200/80 bg-white/80',
    slate: 'border-slate-200/80 bg-white/80',
    violet: 'border-violet-200/80 bg-white/80',
    cyan: 'border-cyan-200/80 bg-white/80',
    amber: 'border-amber-200/80 bg-white/80',
  }[tone];
}

export function toneProgress(tone: DashboardTone) {
  return {
    blue: '[&_[data-slot=progress-indicator]]:bg-blue-500',
    emerald: '[&_[data-slot=progress-indicator]]:bg-emerald-500',
    orange: '[&_[data-slot=progress-indicator]]:bg-orange-500',
    purple: '[&_[data-slot=progress-indicator]]:bg-purple-500',
    rose: '[&_[data-slot=progress-indicator]]:bg-rose-500',
    slate: '[&_[data-slot=progress-indicator]]:bg-slate-500',
    violet: '[&_[data-slot=progress-indicator]]:bg-violet-500',
    cyan: '[&_[data-slot=progress-indicator]]:bg-cyan-500',
    amber: '[&_[data-slot=progress-indicator]]:bg-amber-500',
  }[tone];
}

export function toneBadge(tone: DashboardTone) {
  return {
    blue: 'border-blue-300 bg-blue-100 text-blue-800',
    emerald: 'border-emerald-300 bg-emerald-100 text-emerald-800',
    orange: 'border-orange-300 bg-orange-100 text-orange-800',
    purple: 'border-purple-300 bg-purple-100 text-purple-800',
    rose: 'border-rose-300 bg-rose-100 text-rose-800',
    slate: 'border-slate-300 bg-slate-100 text-slate-700',
    violet: 'border-violet-300 bg-violet-100 text-violet-800',
    cyan: 'border-cyan-300 bg-cyan-100 text-cyan-800',
    amber: 'border-amber-300 bg-amber-100 text-amber-800',
  }[tone];
}
