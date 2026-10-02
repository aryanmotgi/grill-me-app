export function DragHandle({ onDrag, onDone }: { onDrag: (dx: number) => void; onDone: () => void }) {
  return (
    <div
      className="w-[5px] flex-none cursor-col-resize bg-line/40 hover:bg-accent/60 transition-colors"
      onMouseDown={(e) => {
        e.preventDefault();
        let last = e.clientX;
        const move = (ev: MouseEvent) => { onDrag(ev.clientX - last); last = ev.clientX; };
        const up = () => {
          window.removeEventListener("mousemove", move);
          window.removeEventListener("mouseup", up);
          onDone();
        };
        window.addEventListener("mousemove", move);
        window.addEventListener("mouseup", up);
      }}
    />
  );
}
