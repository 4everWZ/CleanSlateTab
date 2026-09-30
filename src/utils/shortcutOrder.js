// DOM indices refer to the unfiltered storage array. Resolve both indices while
// removing legacy empty slots. The insertion boundary can also be apps.length
// to place an item at the end, without swapping any existing shortcut.
export function insertShortcutAt(apps, fromIndex, insertionIndex) {
    if (!Number.isInteger(fromIndex) || !Number.isInteger(insertionIndex) ||
        !apps[fromIndex] || insertionIndex < 0 || insertionIndex > apps.length) return null;

    const ordered = [];
    let from = -1;
    let target = 0;
    apps.forEach((app, index) => {
        if (app == null) return;
        if (index === fromIndex) from = ordered.length;
        if (index < insertionIndex) target++;
        ordered.push(app);
    });
    if (from === target || from + 1 === target) return null;
    const [moved] = ordered.splice(from, 1);
    const insertedIndex = target - (from < target ? 1 : 0);
    ordered.splice(insertedIndex, 0, moved);
    return { apps: ordered, insertedIndex };
}
