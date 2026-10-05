import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
export default function Modal({ title, children, onClose }) {
  const ref=useRef(null);
  useEffect(()=>{const previous=document.activeElement;const dialog=ref.current;dialog.showModal();return()=>{dialog.close();previous?.focus();};},[]);
  return <dialog ref={ref} className="modal" onCancel={e=>{e.preventDefault();onClose();}} onClick={e=>{if(e.target===ref.current)onClose();}}><div className="modal-heading"><h2>{title}</h2><button className="icon-button" onClick={onClose} aria-label="Close dialog"><X size={22}/></button></div>{children}</dialog>;
}
