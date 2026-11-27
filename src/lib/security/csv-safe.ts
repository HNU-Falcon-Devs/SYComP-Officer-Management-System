const FORMULA_PREFIX = /^[=+\-@\t\r]/;

export function neutralizeCsvCell(value: string | number | boolean | null | undefined): string {
    if (value === null || value === undefined) {
        return "";
    }

    let str = String(value);
    if (FORMULA_PREFIX.test(str)) {
        str = `'${str}`;
    }

    if (/[",\n\r]/.test(str)) {
        return `"${str.replace(/"/g, '""')}"`;
    }

    return str;
}

export function formatCsvRow(
    cells: readonly (string | number | boolean | null | undefined)[],
): string {
    return cells.map((cell) => neutralizeCsvCell(cell)).join(",");
}
