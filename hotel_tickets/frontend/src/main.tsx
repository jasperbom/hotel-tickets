import React from "react";
import ReactDOM from "react-dom/client";
import { HashRouter as BrowserRouter } from "react-router-dom";
import App from "./App";
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

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>
);
