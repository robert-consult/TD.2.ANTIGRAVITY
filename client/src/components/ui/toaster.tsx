import * as React from "react";
import { useToast } from "@/hooks/use-toast";
import {
  Toast,
  ToastClose,
  ToastDescription,
  ToastProvider,
  ToastTitle,
  ToastViewport,
} from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { DynamicIcon } from "@/components/ui/dynamic-icon";
import { buildToastView } from "@/lib/error-parser";

function isReactElement(v: unknown): v is React.ReactElement {
  return React.isValidElement(v);
}

export function Toaster() {
  const { toasts } = useToast();

  return (
    <ToastProvider duration={2000}>
      {toasts.map(({ id, title, description, action, variant, ...props }) => {
        const customNode = isReactElement(description) ? description : null;

        const view = buildToastView(customNode ? "" : description, title, variant ?? undefined);
        const { payload, meta, metrics } = view;

        return (
          <Toast
            key={id}
            {...props}
            data-category={meta.category}
            className={cn(
              "toast-premium",
              meta.shadow,
              props.className
            )}
          >
            <div className="toast-shimmer" aria-hidden="true" />

            <div className="flex w-full gap-3">
              <div className={cn("toast-icon", meta.iconBg)}>
                <DynamicIcon
                  name={meta.icon}
                  className={cn("h-5 w-5", meta.iconColor)}
                />
              </div>

              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={cn("toast-badge", meta.badgeText)}>
                        {meta.label}
                      </span>

                      {payload.code ? (
                        <span className="toast-code">
                          {payload.code}
                        </span>
                      ) : null}
                    </div>

                    {view.title ? (
                      <ToastTitle className="toast-title">
                        {view.title}
                      </ToastTitle>
                    ) : null}
                  </div>

                  <ToastClose className="toast-close" />
                </div>

                <ToastDescription className="toast-desc">
                  {customNode ? customNode : payload.message}
                </ToastDescription>

                {metrics ? (
                  <div className="toast-metrics">
                    {metrics}
                  </div>
                ) : null}

                {payload.hint ? (
                  <div className="toast-hint">
                    Hint: {payload.hint}
                  </div>
                ) : null}

                {action ? (
                  <div className="mt-3">
                    {action}
                  </div>
                ) : null}

                {(payload.code || payload.fields) ? (
                  <details className="toast-details">
                    <summary>Details</summary>
                    <pre className="toast-pre">
                      {JSON.stringify(
                        {
                          code: payload.code,
                          hint: payload.hint,
                          ...(payload.fields || {}),
                        },
                        null,
                        2
                      )}
                    </pre>
                  </details>
                ) : null}
              </div>
            </div>
          </Toast>
        );
      })}

      <ToastViewport className="toast-viewport" />
    </ToastProvider>
  );
}
