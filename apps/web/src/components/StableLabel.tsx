// A label that reserves the width of its bold form, so making it bold (the current page, the selected tab)
// never moves what comes after it. Styles: .stable-label.

export function StableLabel({ text }: { text: string }) {
  return (
    <span className="stable-label" data-label={text}>
      {text}
    </span>
  );
}
