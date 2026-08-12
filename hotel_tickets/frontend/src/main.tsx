import React from "react";
import ReactDOM from "react-dom/client";
import { HashRouter as BrowserRouter, useLocation } from "react-router-dom";
import App from "./App";
import Wandscherm from "./pages/Wandscherm";
import { restoreLastRouteBeforeMount } from "./lastRoute";
import { applyCachedBrandingBeforeMount } from "./branding";
import "./index.css";

// Vóór de eerste render, zodat de router direct op de bewaarde pagina start
// (een herstel ná de render toonde eerst kort het ticketoverzicht — dat leek
// op een dubbele refresh van bv. het zwembadcontrole-venster).
restoreLastRouteBeforeMount();

// Ook vóór de eerste render: de laatst bekende huisstijl (kleuren/achtergrond)
// uit de cache toepassen, zodat de standaardkleuren niet kort opflitsen
// terwijl de huisstijl nog uit de API geladen wordt.
applyCachedBrandingBeforeMount();

/**
 * Het wandscherm hangt naast de app, niet erin.
 *
 * App laadt bij het opstarten je profiel, de huisstijl, de fietsinstelling en
 * de ticketteller. Een scherm met een kioskcode heeft geen profiel: die
 * verzoeken geven 401 en zouden een tv aan de muur naar de loginpagina sturen.
 * Door App hier helemaal niet te monteren stelt het bord alleen de vraag die
 * het écht nodig heeft.
 */
function Root() {
  const location = useLocation();
  if (location.pathname === "/wandscherm") return <Wandscherm />;
  return <App />;
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <Root />
    </BrowserRouter>
  </React.StrictMode>
);
