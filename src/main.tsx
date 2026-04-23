import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "react-hot-toast";

import App from "./App";

const queryClient = new QueryClient();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
      <Toaster
        position="bottom-right"
        toastOptions={{
          duration: 3200,
          style: {
            background: "#101722",
            color: "#edf3ff",
            border: "1px solid rgba(132, 148, 170, 0.18)",
            boxShadow: "0 18px 48px rgba(0, 0, 0, 0.38)",
          },
        }}
      />
    </QueryClientProvider>
  </React.StrictMode>,
);
