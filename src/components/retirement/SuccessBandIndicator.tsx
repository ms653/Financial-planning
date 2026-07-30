import type { SuccessBand } from '@/lib/retirement/successBand';

/** Plain-language success-rate band, per `docs/DESIGN_SPEC.md`: "Strong"/"On track"
 * mapped from `successBandFor` — shown alongside the headline percentage so it isn't the
 * only interpretive cue for a probabilistic result. */

const LABEL: Record<SuccessBand, string> = {
  strong: 'Strong',
  'on-track': 'On track',
  'at-risk': 'At risk',
};

const TONE: Record<SuccessBand, string> = {
  strong: 'border-sage/50 bg-sage-bg text-sage',
  'on-track': 'border-sage/50 bg-sage-bg text-sage',
  'at-risk': 'border-clay/50 bg-clay-bg text-clay',
};

export function SuccessBandIndicator({ band }: { band: SuccessBand }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-medium ${TONE[band]}`}
    >
      {LABEL[band]}
    </span>
  );
}
