import { Agent } from "../../web/src/components/Agent";
import { highlightJs } from "../../web/src/highlight";
import { displayKind } from "../../web/src/render/names";
import { clock } from "./timeline";

/** A script a player loaded, as the web's unit panel shows it (C64 highlighting). */
export const ScriptCard: React.FC<{ kind: string; player: string; name: string; color: number; ms: number; code: string; style?: React.CSSProperties }> = ({ kind, player, name, color, ms, code, style }) => (
  <div className="unit-panel" style={{ maxWidth: 560, ...style }}>
    <div className="unit-script">
      <div className="muted">{displayKind(kind)} script of <Agent id={player} name={name} color={color} />: loaded at {clock(ms)}</div>
      <pre style={{ whiteSpace: "pre-wrap" }}><code>{highlightJs(code.trim())}</code></pre>
    </div>
  </div>
);
