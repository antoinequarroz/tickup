export const THEME_KEY = "tickup-theme";

/** Runs before the first paint so a theme forced in Réglages never flashes the other one. */
export const themeScript = `try{var t=localStorage.getItem("${THEME_KEY}");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}`;
