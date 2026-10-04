// GuiOptionButton cycles values in place; keep real form controls for settings/state.
export function nativeOptions(root:HTMLElement){
  const refresh:(()=>void)[]=[];
  for(const field of root.querySelectorAll<HTMLInputElement|HTMLSelectElement>('select,input[type=checkbox]')){
    const label=field.closest('label');if(!label)continue;
    const name=Array.from(label.childNodes).filter(node=>node!==field).map(node=>node.textContent).join('').trim();
    for(const node of [...label.childNodes])if(node!==field)node.remove();
    const text=document.createElement('span');text.className='option-text';label.append(text);field.hidden=true;label.tabIndex=0;label.setAttribute('role','button');label.classList.add('option-button');
    const update=()=>{const value=field instanceof HTMLSelectElement?field.selectedOptions[0]?.textContent??'':field.checked?'オン':'オフ',caption=`${name}: ${value}`;if(text.textContent!==caption)text.textContent=caption;if(field instanceof HTMLInputElement)label.setAttribute('aria-pressed',String(field.checked));};
    const change=()=>{if(field instanceof HTMLSelectElement)field.selectedIndex=(field.selectedIndex+1)%field.options.length;else field.checked=!field.checked;field.dispatchEvent(new Event('input',{bubbles:true}));update();};
    label.addEventListener('click',event=>{event.preventDefault();change();});label.addEventListener('keydown',event=>{if(event.code==='Space'||event.code==='Enter'){event.preventDefault();change();}});refresh.push(update);update();
  }
  return ()=>refresh.forEach(update=>update());
}
