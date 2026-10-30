import { createContext, useContext } from "react";

// Lets the open article tell the header which collection it's in, so the
// header can link back to it. The value is { breadcrumb, setBreadcrumb },
// where breadcrumb is { to, label } or null.
export const BreadcrumbContext = createContext(null);

export const useBreadcrumb = () => useContext(BreadcrumbContext);
