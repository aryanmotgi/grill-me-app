import { useModalA11y } from "../hooks/useModalA11y";
import { useApp } from "../store";
import { FEATURE_GROUPS } from "../data/features";

/** Living in-app docs: every capability, where it lives, one click to open. */
export function FeatureIndex() {
  const st = useApp();
  const modalA11y = useModalA11y("Everything Grill Me can do", st.featureIndexOpen);
  if (!st.featureIndexOpen) return null;
  const close = () => useApp.setState({ featureIndexOpen: false });
  const go = (fn: () => void) => { fn(); close(); };

  return (
    <div className="fixed inset-0 z-40 scrim flex items-start justify-center pt-[5vh]" onClick={close}>
      <div {...modalA11y}
        className="w-[760px] max-h-[86vh] overflow-y-auto glass rounded-md shadow-2xl rise p-6 outline-none"
        onClick={(e) => e.stopPropagation()}>
        <div className="flex items-baseline gap-3 mb-4">
          <span className="font-display font-bold text-[15px]">EVERYTHING GRILL ME CAN DO</span>
          <span className="text-faint text-[10px]">⌘/ opens this anytime</span>
          <button className="btn ml-auto" onClick={close}>close</button>
        </div>
        <div className="grid grid-cols-2 gap-x-8 gap-y-5">
          {FEATURE_GROUPS.map(([group, feats]) => (
            <section key={group}>
              <div className="panel-label mb-2">{group}</div>
              {feats.map((f) => (
                <div key={f.name} className="py-1.5 border-b border-line/40 last:border-0">
                  <div className="flex items-center gap-2">
                    <span className="text-[12px] font-semibold">{f.name}</span>
                    <span className="ml-auto font-mono text-[9px] text-faint">{f.where}</span>
                    {f.go ? <button className="btn" onClick={() => go(f.go!)}>open</button> : null}
                  </div>
                  <div className="text-[10px] text-dim leading-snug">{f.what}</div>
                </div>
              ))}
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
