// No credentials in localStorage. A random epoch only invalidates other tabs.
(()=>{
 const key='mydex.authEpoch';let initial;try{initial=localStorage.getItem(key);}catch{}
 function leave(){sessionStorage.removeItem('mydex.connection');sessionStorage.removeItem('mydex.profiles');location.replace('/connect/');}
 window.addEventListener('storage',e=>{if(e.key===key&&e.newValue!==initial)leave();});
 window.addEventListener('pageshow',()=>{try{if(localStorage.getItem(key)!==initial)leave();}catch{}});
 document.addEventListener('visibilitychange',()=>{if(!document.hidden){try{if(localStorage.getItem(key)!==initial)leave();}catch{}}});
})();
