export const ST={get:(k,d)=>{try{const v=JSON.parse(localStorage.getItem('rs_'+k));return v==null?d:v}catch(e){return d}},set:(k,v)=>{try{localStorage.setItem('rs_'+k,JSON.stringify(v))}catch(e){}}};
