import { createUser } from "./simulacion/usuario-virtual.js";
import "./vista/main.js";
const user = createUser({ delay: 400, timeScale: 1 });
await user
    .moveTo("#test")
    .click()
    .moveTo("#command")
    .click()
    .type("pepe@mail.com\n");
await user.click("#test");
user.destroy();
//# sourceMappingURL=dibutec.js.map