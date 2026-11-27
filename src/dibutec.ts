import { createUser } from "./simulacion/usuario-virtual.js";
import "./vista/main.js";


const user = createUser({ delay: 400, timeScale: 1 });
await user
	.moveTo("#test")
	.click()
	.moveTo("#command")
	.click()
	.type("pepe@mail.com\n");   // \t = Tab, \n = Enter, \b = Backspace
await user.click("#test")/*.waitFor(".toast-ok")*/;
user.destroy();

// Modo rápido para CI (sin esperas ni animaciones):
//const fast = createUser({ timeScale: 0, showCursor: false });

/*
import { workspace } from "./vista/vista.js";
workspace.innerHTML = `
  <svg width="300" height="300" viewBox="0 0 300 300">
	<line x1="20" y1="20" x2="280" y2="280" stroke="blue" stroke-width="2" />
	<rect x="50" y="50" width="200" height="200" fill="none" stroke="red" stroke-width="2" />
  </svg>
`;
*/