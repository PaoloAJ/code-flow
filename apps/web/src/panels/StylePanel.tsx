import { useMemo } from 'react';
import { useStore } from '../store';
import { FILL_SWATCHES, STICKY_SWATCHES, strokeSwatches } from '../theme';

/**
 * Excalidraw-style contextual panel: appears when annotations are selected,
 * edits their shared style properties.
 */
export function StylePanel() {
  const selectedIds = useStore((s) => s.selectedAnnotationIds);
  const annotations = useStore((s) => s.annotations);
  const updateAnnotations = useStore((s) => s.updateAnnotations);
  const duplicateAnnotations = useStore((s) => s.duplicateAnnotations);
  const removeAnnotations = useStore((s) => s.removeAnnotations);
  const setCurrentStyle = useStore((s) => s.setCurrentStyle);
  const theme = useStore((s) => s.theme);

  const selected = useMemo(
    () => annotations.filter((a) => selectedIds.includes(a.id)),
    [annotations, selectedIds],
  );
  if (selected.length === 0) return null;

  const hasDrawn = selected.some((a) => a.type === 'shape' || a.type === 'freehand' || a.type === 'arrow');
  const hasShape = selected.some((a) => a.type === 'shape');
  const hasSticky = selected.some((a) => a.type === 'sticky');
  const hasText = selected.some((a) => a.type === 'label');
  const ids = selected.map((a) => a.id);

  const apply = (patch: Record<string, unknown>, styleKey?: string) => {
    updateAnnotations(ids, patch);
    if (styleKey) setCurrentStyle({ [styleKey]: patch[styleKey] } as never);
  };

  const first = selected[0] as Record<string, unknown>;

  return (
    <div className="style-panel">
      {(hasDrawn || hasText) && (
        <section>
          <label>Stroke</label>
          <div className="swatches">
            {strokeSwatches(theme).map((c) => (
              <button
                key={c}
                className={`swatch${first.stroke === c || first.color === c ? ' active' : ''}`}
                style={{ background: c }}
                onClick={() => {
                  if (hasText) apply({ color: c });
                  if (hasDrawn) apply({ stroke: c }, 'stroke');
                }}
              />
            ))}
          </div>
        </section>
      )}

      {hasShape && (
        <section>
          <label>Background</label>
          <div className="swatches">
            {FILL_SWATCHES.map((c) => (
              <button
                key={c}
                className={`swatch${first.fill === c ? ' active' : ''}${c === 'transparent' ? ' none' : ''}`}
                style={{ background: c === 'transparent' ? undefined : c }}
                onClick={() => apply({ fill: c, fillStyle: c === 'transparent' ? 'none' : 'hachure' }, 'fill')}
              />
            ))}
          </div>
          <label>Fill style</label>
          <div className="seg">
            {(['none', 'hachure', 'cross-hatch', 'solid'] as const).map((fs) => (
              <button
                key={fs}
                className={first.fillStyle === fs ? 'active' : ''}
                onClick={() => apply({ fillStyle: fs }, 'fillStyle')}
                title={fs}
              >
                {fs === 'none' ? '∅' : fs === 'hachure' ? '⧅' : fs === 'cross-hatch' ? '⊞' : '■'}
              </button>
            ))}
          </div>
        </section>
      )}

      {hasSticky && (
        <section>
          <label>Note color</label>
          <div className="swatches">
            {STICKY_SWATCHES.map((c) => (
              <button key={c} className="swatch" style={{ background: c }} onClick={() => apply({ color: c })} />
            ))}
          </div>
        </section>
      )}

      {hasDrawn && (
        <section>
          <label>Stroke width</label>
          <div className="seg">
            {[1, 2, 4].map((w) => (
              <button
                key={w}
                className={first.strokeWidth === w ? 'active' : ''}
                onClick={() => apply({ strokeWidth: w }, 'strokeWidth')}
              >
                <svg width="20" height="10">
                  <line x1="1" y1="5" x2="19" y2="5" stroke="currentColor" strokeWidth={w} strokeLinecap="round" />
                </svg>
              </button>
            ))}
          </div>
          <label>Stroke style</label>
          <div className="seg">
            {(['solid', 'dashed', 'dotted'] as const).map((ss) => (
              <button
                key={ss}
                className={(first.strokeStyle ?? 'solid') === ss ? 'active' : ''}
                onClick={() => apply({ strokeStyle: ss }, 'strokeStyle')}
                title={ss}
              >
                <svg width="20" height="10">
                  <line
                    x1="1"
                    y1="5"
                    x2="19"
                    y2="5"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeDasharray={ss === 'dashed' ? '5 4' : ss === 'dotted' ? '1.5 4' : undefined}
                  />
                </svg>
              </button>
            ))}
          </div>
          <label>Sloppiness</label>
          <div className="seg">
            {(['architect', 'artist', 'cartoonist'] as const).map((sl) => (
              <button
                key={sl}
                className={(first.sloppiness ?? 'architect') === sl ? 'active' : ''}
                onClick={() => apply({ sloppiness: sl }, 'sloppiness')}
                title={sl}
              >
                <svg width="20" height="10">
                  <path
                    d={
                      sl === 'architect'
                        ? 'M1 5 L19 5'
                        : sl === 'artist'
                          ? 'M1 6 Q6 3 10 5.5 T19 4.5'
                          : 'M1 7 Q4 1 8 6 T14 4 T19 7'
                    }
                    stroke="currentColor"
                    strokeWidth="1.6"
                    fill="none"
                    strokeLinecap="round"
                  />
                </svg>
              </button>
            ))}
          </div>
        </section>
      )}

      {hasText && (
        <section>
          <label>Font size</label>
          <div className="seg">
            {[14, 20, 32].map((fs) => (
              <button
                key={fs}
                className={first.fontSize === fs ? 'active' : ''}
                onClick={() => apply({ fontSize: fs })}
              >
                {fs === 14 ? 'S' : fs === 20 ? 'M' : 'L'}
              </button>
            ))}
          </div>
        </section>
      )}

      <section>
        <label>Opacity</label>
        <input
          type="range"
          min={0.1}
          max={1}
          step={0.05}
          value={(first.opacity as number) ?? 1}
          onChange={(e) => apply({ opacity: Number(e.target.value) }, 'opacity')}
        />
      </section>

      <section className="actions">
        <button title="Duplicate" onClick={() => duplicateAnnotations(ids)}>
          ⧉
        </button>
        <button title="Delete" onClick={() => removeAnnotations(ids)}>
          🗑
        </button>
      </section>
    </div>
  );
}
