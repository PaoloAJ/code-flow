import { useStore, type Tool } from '../store';

/** Excalidraw's tool order and number shortcuts. */
const TOOLS: { tool: Tool; icon: string; label: string; keys: string }[] = [
  { tool: 'hand', icon: '✋', label: 'Hand (panning tool)', keys: 'H' },
  { tool: 'select', icon: '⌖', label: 'Selection', keys: 'V or 1' },
  { tool: 'shape-rect', icon: '▭', label: 'Rectangle', keys: 'R or 2' },
  { tool: 'shape-diamond', icon: '◇', label: 'Diamond', keys: 'D or 3' },
  { tool: 'shape-ellipse', icon: '○', label: 'Ellipse', keys: 'O or 4' },
  { tool: 'arrow', icon: '→', label: 'Arrow', keys: 'A or 5' },
  { tool: 'line', icon: '—', label: 'Line', keys: 'L or 6' },
  { tool: 'draw', icon: '✎', label: 'Draw', keys: 'P or 7' },
  { tool: 'label', icon: 'T', label: 'Text', keys: 'T or 8' },
  { tool: 'sticky', icon: '🗒', label: 'Sticky note', keys: 'S' },
  { tool: 'eraser', icon: '◪', label: 'Eraser', keys: 'E or 0' },
];

const HINTS: Partial<Record<Tool, string>> = {
  select: '1',
  'shape-rect': '2',
  'shape-diamond': '3',
  'shape-ellipse': '4',
  arrow: '5',
  line: '6',
  draw: '7',
  label: '8',
  eraser: '0',
  hand: 'H',
  sticky: 'S',
};

export function Toolbar() {
  const tool = useStore((s) => s.tool);
  const setTool = useStore((s) => s.setTool);
  const toolLocked = useStore((s) => s.toolLocked);
  const toggleToolLocked = useStore((s) => s.toggleToolLocked);
  return (
    <div className="toolbar">
      <button
        className={toolLocked ? 'active' : ''}
        title="Keep selected tool active after drawing — Q"
        onClick={toggleToolLocked}
      >
        <span className="icon">{toolLocked ? '🔒' : '🔓'}</span>
      </button>
      <span className="divider" />
      {TOOLS.map((t) => (
        <button
          key={t.tool}
          className={tool === t.tool ? 'active' : ''}
          title={`${t.label} — ${t.keys}`}
          onClick={() => setTool(t.tool)}
        >
          <span className="icon">{t.icon}</span>
          <span className="hint">{HINTS[t.tool]}</span>
        </button>
      ))}
    </div>
  );
}
