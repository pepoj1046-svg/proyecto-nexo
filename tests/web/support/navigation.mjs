export async function navigate(page,label){
 const open=page.getByRole('button',{name:'Abrir navegación',exact:true});
 if(await open.isVisible())await open.click();
 await page.getByRole('navigation',{name:'Navegación principal'}).getByRole('link',{name:label,exact:true}).click();
}
