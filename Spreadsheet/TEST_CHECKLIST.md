# SpreadsheetWindow Test Checklist

## Basic Editing

### Cell Selection
- [ ] Click cell to select - shows blue border
- [ ] Arrow keys move selection
- [ ] Shift+click creates range selection
- [ ] Drag to select range
- [ ] Selection cleared when clicking single cell

### Cell Editing
- [ ] Double-click cell to edit
- [ ] Type to start editing immediately
- [ ] Enter confirms edit and moves down
- [ ] Tab confirms edit and moves right
- [ ] Escape cancels edit
- [ ] Formula bar shows cell content
- [ ] Editing formula bar updates cell

### Cell Content
- [ ] Delete/Backspace clears cell content
- [ ] Delete clears entire selection
- [ ] Empty cells display empty

---

## Navigation

### Keyboard Navigation
- [ ] Arrow Up moves up
- [ ] Arrow Down moves down
- [ ] Arrow Left moves left
- [ ] Arrow Right moves right
- [ ] Shift+Arrow extends selection
- [ ] Navigation stops at grid boundaries

### Scroll Behavior
- [ ] Grid scrolls horizontally
- [ ] Grid scrolls vertically
- [ ] Headers remain sticky when scrolling

---

## Formulas

### Basic Functions
- [ ] `=SUM(A1:A10)` calculates correctly
- [ ] `=AVERAGE(B1:B5)` calculates correctly
- [ ] `=COUNT(C1:C10)` counts numeric cells
- [ ] `=COUNTA(C1:C10)` counts non-empty cells
- [ ] `=MIN(D1:D5)` finds minimum
- [ ] `=MAX(E1:E5)` finds maximum

### Conditional Logic
- [ ] `=IF(A1>0,"Yes","No")` returns correct value
- [ ] `=IF(A1=B1,1,0)` equality check works
- [ ] `=AND(A1>0,B1>0)` returns 1 or 0
- [ ] `=OR(A1>0,B1>0)` returns 1 or 0
- [ ] `=NOT(A1>0)` inverts condition

### Math Functions
- [ ] `=ABS(-5)` returns 5
- [ ] `=ROUND(3.14159, 2)` returns 3.14
- [ ] `=FLOOR(3.7)` returns 3
- [ ] `=CEILING(3.2)` returns 4
- [ ] `=SQRT(16)` returns 4
- [ ] `=POWER(2,3)` returns 8
- [ ] `=MOD(10,3)` returns 1
- [ ] `=PI()` returns ~3.14159
- [ ] `=RAND()` returns random 0-1
- [ ] `=RANDBETWEEN(1,10)` returns random 1-10

### Text Functions
- [ ] `=CONCATENATE("Hello"," ","World")` returns "Hello World"
- [ ] `=LEN("Hello")` returns 5
- [ ] `=UPPER("hello")` returns "HELLO"
- [ ] `=LOWER("HELLO")` returns "hello"
- [ ] `=TRIM("  hello  ")` returns "hello"
- [ ] `=LEFT("Hello",3)` returns "Hel"
- [ ] `=RIGHT("Hello",2)` returns "lo"
- [ ] `=MID("Hello",2,3)` returns "ell"
- [ ] `=SUBSTITUTE("Hello","l","L")` replaces all occurrences
- [ ] `=REPT("*",5)` returns "*****"

### Date Functions
- [ ] `=TODAY()` returns current date
- [ ] `=NOW()` returns current date/time
- [ ] `=YEAR()` returns current year
- [ ] `=MONTH()` returns current month
- [ ] `=DAY()` returns current day

### Cell References
- [ ] `=A1` returns value of A1
- [ ] `=A1+B1` adds two cells
- [ ] `=A1*2` multiplies cell by constant
- [ ] Cell references update when cells change

### Error Handling
- [ ] Circular reference shows `#CIRCULAR!`
- [ ] Invalid reference shows `#REF!`
- [ ] Invalid formula shows `#ERROR!`
- [ ] Division by zero shows `#DIV/0!`
- [ ] Unknown function shows `#NAME?`
- [ ] `=IFERROR(1/0,"Error")` returns "Error"

### Arithmetic Expressions
- [ ] `=1+2` returns 3
- [ ] `=10-5` returns 5
- [ ] `=3*4` returns 12
- [ ] `=20/4` returns 5
- [ ] `=(1+2)*3` returns 9 (parentheses)
- [ ] `=-5` returns -5 (negative numbers)

---

## Clipboard Operations

### Copy
- [ ] Ctrl+C copies selected cell
- [ ] Ctrl+C copies selection range
- [ ] Copy button works
- [ ] "Cells copied" message appears

### Cut
- [ ] Ctrl+X cuts selected cell
- [ ] Ctrl+X clears original cells
- [ ] Cut button works
- [ ] "Cells cut" message appears

### Paste
- [ ] Ctrl+V pastes at selected cell
- [ ] Paste adjusts to target position
- [ ] Paste button works
- [ ] "Cells pasted" message appears
- [ ] Pasting preserves formatting

---

## Cell Formatting

### Text Styles
- [ ] Bold button toggles bold
- [ ] Italic button toggles italic
- [ ] Formatting persists after save/load

### Text Alignment
- [ ] Left alignment works
- [ ] Center alignment works
- [ ] Right alignment works

### Colors
- [ ] Fill color picker changes background
- [ ] Text color picker changes text
- [ ] Colors display correctly
- [ ] Colors persist after save/load

### Number Formatting
- [ ] General format (default)
- [ ] Number format (2 decimals)
- [ ] Currency format ($1,234.00)
- [ ] Percentage format (12.34%)
- [ ] Scientific format (1.23E+4)
- [ ] Formatting applies to selection

---

## Row/Column Operations

### Insert Row
- [ ] "+ Row" button inserts row above
- [ ] New row is empty
- [ ] Existing data shifts down
- [ ] Formula references update correctly

### Delete Row
- [ ] "- Row" button deletes current row
- [ ] Data shifts up
- [ ] Formula references update correctly
- [ ] Cannot delete last row

### Insert Column
- [ ] "+ Col" button inserts column left
- [ ] New column is empty
- [ ] Existing data shifts right
- [ ] Formula references update correctly

### Delete Column
- [ ] "- Col" button deletes current column
- [ ] Data shifts left
- [ ] Formula references update correctly
- [ ] Cannot delete last column

---

## Undo/Redo

### Undo Operations
- [ ] Ctrl+Z undoes last action
- [ ] Undo button works
- [ ] Undo reverts cell edits
- [ ] Undo reverts formatting
- [ ] Undo reverts row/column operations
- [ ] Undo reverts paste
- [ ] Undo reverts cut
- [ ] Multiple undos work sequentially
- [ ] Undo count shows in status bar

### Redo Operations
- [ ] Ctrl+Y redoes last undo
- [ ] Ctrl+Shift+Z redoes last undo
- [ ] Redo button works
- [ ] Redo count shows in status bar
- [ ] New action clears redo stack

### Button States
- [ ] Undo button disabled when no history
- [ ] Redo button disabled when no redo available

---

## Search & Replace

### Opening Search
- [ ] Ctrl+F opens search bar
- [ ] Find button opens search bar
- [ ] Escape closes search bar
- [ ] X button closes search bar

### Find Operations
- [ ] Typing in search field works
- [ ] Find Next highlights matches
- [ ] Find Prev moves to previous match
- [ ] Enter triggers Find Next
- [ ] Shift+Enter triggers Find Prev
- [ ] Match count displays correctly
- [ ] Current match highlighted differently

### Search Options
- [ ] Case sensitive option works
- [ ] Whole cell match option works

### Replace Operations
- [ ] Replace replaces current match
- [ ] Replace All replaces all matches
- [ ] Replace count message appears
- [ ] Replace is undoable

---

## File Operations

### New Spreadsheet
- [ ] New button clears grid
- [ ] Prompts if unsaved changes
- [ ] Resets file name to "Untitled"
- [ ] Clears undo history

### Save
- [ ] Save button saves to .sheet file
- [ ] Prompts for location if new file
- [ ] Updates file name in title
- [ ] Shows "(saved)" status

### Save As
- [ ] Save As prompts for new location
- [ ] Allows changing file name
- [ ] Updates file path

### Open
- [ ] Open button shows file dialog
- [ ] Opens .sheet files correctly
- [ ] Opens .xlsx files correctly
- [ ] Opens .csv files correctly
- [ ] Preserves formatting from xlsx
- [ ] Clears undo history on load

### Export CSV
- [ ] Export CSV creates download
- [ ] CSV properly escapes commas
- [ ] CSV properly escapes quotes
- [ ] CSV handles newlines in cells

### Export XLSX
- [ ] Export XLSX creates download
- [ ] Excel file opens correctly
- [ ] Formulas exported correctly
- [ ] Column widths preserved

---

## Column Resize

- [ ] Cursor changes on header edge
- [ ] Dragging resizes column
- [ ] Minimum width enforced (40px)
- [ ] Resize handle highlights on hover
- [ ] Column width persists

---

## Status Bar

- [ ] Shows selected cell address
- [ ] Shows "Ready" when no selection
- [ ] Shows Sum for multiple numeric cells
- [ ] Shows Average for multiple numeric cells
- [ ] Shows Count for multiple cells
- [ ] Shows Undo/Redo counts

---

## Selection Highlighting

- [ ] Selected cell has blue border
- [ ] Selection range has blue tint
- [ ] Search matches have yellow background
- [ ] Current search match has orange background

---

## Edge Cases

### Data Edge Cases
- [ ] Very long text displays with ellipsis
- [ ] Very large numbers display correctly
- [ ] Negative numbers display correctly
- [ ] Empty string vs. zero distinction
- [ ] Unicode characters work

### Grid Edge Cases
- [ ] First cell (A1) works correctly
- [ ] Last visible cell works correctly
- [ ] Operations at grid boundaries
- [ ] Very wide columns work
- [ ] Very tall rows work

### Formula Edge Cases
- [ ] Empty cells in formula ranges
- [ ] Text in numeric formulas
- [ ] Nested functions
- [ ] Self-referencing cell (circular)
- [ ] Deeply nested parentheses

---

## Performance

- [ ] Scrolling is smooth
- [ ] Typing has no lag
- [ ] Large selection is responsive
- [ ] Formula calculation is fast
- [ ] Undo/redo is instant

---

## Browser Compatibility (if applicable)

- [ ] Works in Chrome
- [ ] Works in Firefox
- [ ] Works in Edge
- [ ] Works in Safari

---

## Notes

_Use this section to document any issues found during testing:_

