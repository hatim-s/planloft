import type {} from "react";

// Components pass per-instance values to their CSS through `--pl-*` custom properties.
declare module "react" {
  interface CSSProperties {
    [variable: `--pl-${string}`]: string | number | undefined;
  }
}
