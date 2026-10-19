import { useEffect, useId, useRef, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import './LocationSelect.css';

export default function LocationSelect({ value, options, onChange, label = 'Building', compact = false }) {
  const id = useId();
  const trigger = useRef(null);
  const menu = useRef(null);
  const search = useRef({ text: '', time: 0 });
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  function show() {
    if (!options.length) return;
    if (compact) {
      const rect = trigger.current.getBoundingClientRect();
      const viewport = window.visualViewport;
      const bottom = (viewport?.offsetTop || 0) + (viewport?.height || window.innerHeight);
      if (rect.bottom + options.length * 42 + 28 > bottom) trigger.current.scrollIntoView({ block: 'center', behavior: 'instant' });
    }
    setActive(Math.max(0, options.indexOf(value))); setOpen(true);
  }
  function choose(index) { onChange(options[index]); setOpen(false); trigger.current?.focus(); }

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

  return <div className={`location-select${compact ? ' floor-dropdown' : ''}`}>
    <button ref={trigger} type="button" role="combobox" disabled={!options.length} aria-label={label} aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? id : undefined} aria-activedescendant={open ? `${id}-${active}` : undefined} className="location-trigger" onClick={() => open ? setOpen(false) : show()} onKeyDown={onKeyDown} onBlur={() => setOpen(false)}>
      <span>{value}</span><ChevronDown size={compact ? 16 : 19} aria-hidden="true"/>
    </button>
    {open && <div ref={menu} id={id} role="listbox" aria-label={label} className={`location-menu${compact ? ' floor-dropdown-menu' : ''}`} onMouseDown={event => event.preventDefault()}>
      {options.map((option, index) => <div key={option} id={`${id}-${index}`} role="option" aria-selected={option === value} className={`location-option${index === active ? ' is-active' : ''}`} onPointerMove={() => setActive(index)} onClick={() => choose(index)}>
        <span>{option}</span>{option === value && <Check size={19} aria-hidden="true"/>}
      </div>)}
    </div>}
  </div>;
}
