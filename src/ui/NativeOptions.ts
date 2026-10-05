// GuiOptionButton cycles values in place; keep real form controls for settings/state.
export function nativeOptions(root:HTMLElement){
  const refresh:(()=>void)[]=[];
  for(const field of root.querySelectorAll<HTMLInputElement>('input[type=range]')){
    const label=field.closest('label');if(!label)continue;
    const caption=document.createElement('span');caption.className='slider-caption';
    for(const node of [...label.childNodes])if(node!==field)caption.append(node);
    const thumb=document.createElement('span');thumb.className='slider-thumb';thumb.setAttribute('aria-hidden','true');
    label.append(thumb,caption);
    const update=()=>{
      // GuiOptionSlider uses an 8 x 20 handle, integer pixel positions and a 4px inset.
      const fraction=(Number(field.value)-Number(field.min))/(Number(field.max)-Number(field.min));
      thumb.style.left=`${Math.floor(fraction*((field.clientWidth||150)-8))}px`;
      field.setAttribute('aria-label',caption.textContent??'');
      field.setAttribute('aria-valuetext',caption.querySelector('output')?.textContent??field.value);
    };
    field.addEventListener('input',update);window.addEventListener('resize',update);refresh.push(update);
  }
  for(const field of root.querySelectorAll<HTMLInputElement|HTMLSelectElement>('select,input[type=checkbox]')){
    const label=field.closest('label');if(!label)continue;
    const name=Array.from(label.childNodes).filter(node=>node!==field).map(node=>node.textContent).join('').trim();
    for(const node of [...label.childNodes])if(node!==field)node.remove();
    const text=document.createElement('span');text.className='option-text';label.append(text);field.hidden=true;label.tabIndex=0;label.setAttribute('role','button');label.classList.add('option-button');
    const update=()=>{const value=field instanceof HTMLSelectElement?field.selectedOptions[0]?.textContent??'':field.checked?'ON':'OFF',caption=`${name}: ${value}`;if(text.textContent!==caption)text.textContent=caption;if(field instanceof HTMLInputElement)label.setAttribute('aria-pressed',String(field.checked));};
    const change=()=>{if(field instanceof HTMLSelectElement)field.selectedIndex=(field.selectedIndex+1)%field.options.length;else field.checked=!field.checked;field.dispatchEvent(new Event('input',{bubbles:true}));update();};
    label.addEventListener('click',event=>{event.preventDefault();change();});label.addEventListener('keydown',event=>{if(event.code==='Space'||event.code==='Enter'){event.preventDefault();change();}});refresh.push(update);update();
  }
  return ()=>refresh.forEach(update=>update());
}
