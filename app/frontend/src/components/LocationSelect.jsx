import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown } from 'lucide-react';
import './LocationSelect.css';

export default function LocationSelect({ value, options, onChange }) {
  const id = useId();
  const trigger = useRef(null);
  const menu = useRef(null);
  const search = useRef({ text: '', time: 0 });
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [position, setPosition] = useState({});
  function show() { setActive(Math.max(0, options.indexOf(value))); setOpen(true); }
  function choose(index) { onChange(options[index]); setOpen(false); trigger.current?.focus(); }

  useLayoutEffect(() => {
    if (!open) return;
    function place() {
      const rect = trigger.current.getBoundingClientRect();
      const viewport = window.visualViewport;
      const topEdge = viewport?.offsetTop || 0;
      const bottomEdge = topEdge + (viewport?.height || window.innerHeight);
      const below = bottomEdge - rect.bottom - 16;
      const above = rect.top - topEdge - 16;
      const height = Math.min(options.length * 48 + 12, Math.max(below, above), 340);
      const flip = below < height && above > below;
      setPosition({ left: rect.left, width: rect.width, top: flip ? rect.top - height - 8 : rect.bottom + 8, maxHeight: Math.max(48, height) });
    }
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    window.visualViewport?.addEventListener('resize', place);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
      window.visualViewport?.removeEventListener('resize', place);
    };
  }, [open, options.length]);
  useEffect(() => {
    if (!open) return;
    const outside = event => { if (!trigger.current?.contains(event.target) && !menu.current?.contains(event.target)) setOpen(false); };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);
  useEffect(() => { if (open) menu.current?.children[active]?.scrollIntoView({ block: 'nearest' }); }, [active, open]);

  function onKeyDown(event) {
    const key = event.key;
    if (key === 'Tab') { setOpen(false); return; }
    if (key === 'Escape') { event.preventDefault(); setOpen(false); return; }
    if (['ArrowDown', 'ArrowUp', 'Home', 'End', 'Enter', ' '].includes(key)) {
      event.preventDefault();
      if (!open) { show(); return; }
      if (key === 'Enter' || key === ' ') { choose(active); return; }
      setActive(index => key === 'Home' ? 0 : key === 'End' ? options.length - 1 : (index + (key === 'ArrowDown' ? 1 : -1) + options.length) % options.length);
    } else if (key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      const now = Date.now();
      search.current = { text: (now - search.current.time < 700 ? search.current.text : '') + key.toLowerCase(), time: now };
      const match = options.findIndex(option => option.toLowerCase().startsWith(search.current.text));
      if (match !== -1) { setActive(match); setOpen(true); }
    }
  }

  return <div className="location-select">
    <button ref={trigger} type="button" role="combobox" aria-label="Building" aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? id : undefined} aria-activedescendant={open ? `${id}-${active}` : undefined} className="location-trigger" onClick={() => open ? setOpen(false) : show()} onKeyDown={onKeyDown} onBlur={() => setOpen(false)}>
      <span>{value}</span><ChevronDown size={19} aria-hidden="true"/>
    </button>
    {open && createPortal(<div ref={menu} id={id} role="listbox" aria-label="Building" className="location-menu" style={position} onMouseDown={event => event.preventDefault()}>
      {options.map((option, index) => <div key={option} id={`${id}-${index}`} role="option" aria-selected={option === value} className={`location-option${index === active ? ' is-active' : ''}`} onPointerMove={() => setActive(index)} onClick={() => choose(index)}>
        <span>{option}</span>{option === value && <Check size={19} aria-hidden="true"/>}
      </div>)}
    </div>, document.body)}
  </div>;
}
