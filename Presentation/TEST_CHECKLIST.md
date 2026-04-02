# Presentation Workflow Testing Checklist

## File Operations

### New Presentation
- [ ] Click "New" button creates blank presentation
- [ ] New presentation has one empty slide
- [ ] Warns about unsaved changes if current has changes
- [ ] Sets filename to "Untitled Presentation"
- [ ] Clears undo history
- [ ] **Keyboard**: Ctrl+N triggers new

### Save Presentation
- [ ] **Ctrl+S** triggers save
- [ ] First save shows save dialog
- [ ] Can save as .pres format
- [ ] Can save as .json format
- [ ] Subsequent saves overwrite existing file
- [ ] Status changes from "(unsaved)" to "(saved)"
- [ ] Filename updates in header
- [ ] File path shown after save

### Save As
- [ ] Opens dialog even if file already saved
- [ ] Can choose different location
- [ ] Updates filename and path
- [ ] **Ctrl+Shift+S** triggers Save As

### Open Presentation
- [ ] **Ctrl+O** triggers open dialog
- [ ] Can open .pres files
- [ ] Can open .json files
- [ ] Clears undo history on load
- [ ] Updates filename and path

### Export HTML
- [ ] Creates standalone HTML file
- [ ] HTML opens in browser correctly
- [ ] Arrow keys navigate slides in exported file
- [ ] Spacebar advances slides
- [ ] All elements render correctly
- [ ] Shapes (rectangle, ellipse, triangle) display properly

---

## Slide Management

### Add Slide
- [ ] "+ Add" button inserts after current slide
- [ ] New slide is empty (blank template)
- [ ] Current slide index updates
- [ ] Thumbnail appears in slide panel

### Slide Templates
- [ ] Template dropdown shows 5 templates
- [ ] "Blank" creates empty slide
- [ ] "Title Slide" creates title + subtitle
- [ ] "Title and Content" creates title + body
- [ ] "Two Content" creates title + two columns
- [ ] "Section Header" creates large centered text with blue background

### Delete Slide
- [ ] "Del" button removes current slide
- [ ] Cannot delete last slide (button disabled)
- [ ] Current index adjusts appropriately
- [ ] Thumbnail removed from panel

### Duplicate Slide
- [ ] "Dup" button creates exact copy
- [ ] All elements copied with new IDs
- [ ] Background color preserved
- [ ] Notes preserved
- [ ] Inserted after current slide

### Slide Reordering (Drag & Drop)
- [ ] Can drag slide thumbnail
- [ ] Drag indicator shows while dragging
- [ ] Drop position highlighted
- [ ] Slides reorder on drop
- [ ] Operation is undoable

### Slide Navigation
- [ ] Click thumbnail to select slide
- [ ] Current slide has blue border
- [ ] **PageDown** goes to next slide
- [ ] **PageUp** goes to previous slide
- [ ] Selection cleared when changing slides

---

## Element Creation

### Add Text
- [ ] "+ Text" button adds text box
- [ ] Text box appears at slide center
- [ ] Default content is "Click to edit"
- [ ] Default style: 24px Arial, white, left-aligned

### Add Image
- [ ] "+ Image" button opens file picker
- [ ] Supports PNG images
- [ ] Supports JPG images
- [ ] Supports GIF images
- [ ] Image maintains aspect ratio
- [ ] Image scaled to max 400px width

### Add Shapes
- [ ] "Rect" creates rectangle
- [ ] "Ellipse" creates ellipse (rounded)
- [ ] "Triangle" creates triangle (clip-path)
- [ ] Shapes have default blue fill
- [ ] Shapes have white text color

---

## Element Selection

### Single Selection
- [ ] Click element to select
- [ ] Selected element has blue outline
- [ ] 8 resize handles appear
- [ ] Click empty area deselects
- [ ] **Escape** deselects

### Multi-Selection
- [ ] Shift+click adds to selection
- [ ] Ctrl+click adds to selection
- [ ] Shift+click on selected removes from selection
- [ ] Dashed bounding box around multiple elements
- [ ] Alignment buttons appear for multiple selection

### Select All
- [ ] **Ctrl+A** selects all elements on current slide

---

## Element Editing

### Text Editing
- [ ] Double-click text enters edit mode
- [ ] Cursor appears in text
- [ ] Can type and edit text
- [ ] Multi-line text supported
- [ ] **Escape** exits edit mode
- [ ] Click outside exits edit mode

### Shape Text
- [ ] Double-click shape enters text edit mode
- [ ] Can add text to shapes
- [ ] Text centered in shape by default

---

## Element Manipulation

### Dragging
- [ ] Click and drag moves element
- [ ] Cursor changes to grabbing
- [ ] Element constrained to slide bounds
- [ ] Position saved on release
- [ ] Move is undoable

### Multi-Drag
- [ ] Moving one selected element moves all selected
- [ ] Relative positions maintained
- [ ] All elements constrained to bounds

### Resizing
- [ ] NW handle resizes from top-left
- [ ] N handle resizes height from top
- [ ] NE handle resizes from top-right
- [ ] E handle resizes width from right
- [ ] SE handle resizes from bottom-right
- [ ] S handle resizes height from bottom
- [ ] SW handle resizes from bottom-left
- [ ] W handle resizes width from left
- [ ] Minimum size enforced (50x30 px)
- [ ] Resize is undoable

### Nudging
- [ ] **Arrow Up** moves selected up 1px
- [ ] **Arrow Down** moves selected down 1px
- [ ] **Arrow Left** moves selected left 1px
- [ ] **Arrow Right** moves selected right 1px
- [ ] **Shift+Arrow** moves 10px
- [ ] Constrained to slide bounds

### Delete
- [ ] **Delete** key removes selected element(s)
- [ ] **Backspace** removes selected element(s)
- [ ] Delete button in toolbar removes element
- [ ] Delete is undoable

---

## Clipboard Operations

### Copy
- [ ] **Ctrl+C** copies selected element(s)
- [ ] "Copied X element(s)" message appears
- [ ] Original element unchanged

### Cut
- [ ] **Ctrl+X** cuts selected element(s)
- [ ] "Cut X element(s)" message appears
- [ ] Original element removed
- [ ] Cut is undoable

### Paste
- [ ] **Ctrl+V** pastes copied element(s)
- [ ] Pasted elements offset 20px from original
- [ ] Multiple pastes offset incrementally
- [ ] Paste creates new IDs
- [ ] "Pasted X element(s)" message appears
- [ ] Paste is undoable

### Duplicate
- [ ] **Ctrl+D** duplicates selected element(s)
- [ ] Duplicates offset 20px
- [ ] New IDs generated
- [ ] Duplicate is undoable

---

## Z-Ordering

### Bring to Front
- [ ] Toolbar button brings element to front
- [ ] **Ctrl+Shift+]** brings to front
- [ ] Element renders above all others

### Send to Back
- [ ] Toolbar button sends element to back
- [ ] **Ctrl+Shift+[** sends to back
- [ ] Element renders below all others

### Bring Forward
- [ ] **Ctrl+]** brings element forward one level
- [ ] Only affects immediate z-order

### Send Backward
- [ ] **Ctrl+[** sends element backward one level
- [ ] Only affects immediate z-order

### Z-Order Persistence
- [ ] Z-order preserved in save/load
- [ ] Z-order changes are undoable

---

## Text Formatting

### Font Family
- [ ] Dropdown shows 10 font options
- [ ] Changing font applies to selected element
- [ ] Font preserved in save/load

### Font Size
- [ ] Dropdown shows sizes 12-96px
- [ ] Changing size applies to selected element
- [ ] Size preserved in save/load

### Bold
- [ ] **B** button toggles bold
- [ ] Button highlights when active
- [ ] **Ctrl+B** toggles bold

### Italic
- [ ] **I** button toggles italic
- [ ] Button highlights when active
- [ ] **Ctrl+I** toggles italic

### Text Color
- [ ] Color picker works
- [ ] Color applies to selected element
- [ ] Color preserved in save/load

### Fill Color
- [ ] Color picker works
- [ ] Fill applies to selected element
- [ ] Fill preserved in save/load

### Text Alignment
- [ ] Left align button works
- [ ] Center align button works
- [ ] Right align button works
- [ ] Active button highlights
- [ ] Alignment preserved in save/load

---

## Lists

### Bullet List
- [ ] "• List" button toggles bullet list
- [ ] Button highlights when active
- [ ] Bullets added to each line
- [ ] New lines get bullets automatically
- [ ] Toggle off removes bullets

### Numbered List
- [ ] "1. List" button toggles numbered list
- [ ] Button highlights when active
- [ ] Numbers added to each line (1. 2. 3. etc.)
- [ ] New lines get next number
- [ ] Toggle off removes numbers

---

## Alignment Tools (Multi-Select)

### Horizontal Alignment
- [ ] Align Left button aligns to leftmost edge
- [ ] Align Center button centers horizontally
- [ ] Align Right button aligns to rightmost edge

### Vertical Alignment
- [ ] Align Top button aligns to top edge
- [ ] Align Middle button centers vertically
- [ ] Align Bottom button aligns to bottom edge

---

## Speaker Notes

### Notes Panel
- [ ] Click header toggles expand/collapse
- [ ] Textarea for entering notes
- [ ] Character count displayed
- [ ] Notes indicator (●) shows when notes exist

### Notes Persistence
- [ ] Notes saved with presentation
- [ ] Notes loaded correctly
- [ ] Notes preserved per slide

---

## Properties Panel

### Slide Properties
- [ ] Background color picker works
- [ ] Color applies to current slide immediately

### View Settings
- [ ] Zoom slider adjusts view (25%-200%)
- [ ] Zoom percentage displayed
- [ ] Slide scales correctly

### Grid Settings
- [ ] "Show grid" checkbox toggles grid
- [ ] Grid visible on slide
- [ ] "Snap to grid" checkbox toggles snapping
- [ ] Grid size dropdown (5px, 10px, 20px, 40px)

### Element Properties
- [ ] Shows type of selected element
- [ ] Shows X, Y, Width, Height
- [ ] Shows font family when applicable
- [ ] Updates in real-time during drag/resize

---

## Undo/Redo

### Undo Operations
- [ ] **Ctrl+Z** undoes last action
- [ ] Undo button works
- [ ] Undo reverts element additions
- [ ] Undo reverts element deletions
- [ ] Undo reverts element moves
- [ ] Undo reverts element resizes
- [ ] Undo reverts formatting changes
- [ ] Undo reverts slide additions
- [ ] Undo reverts slide deletions
- [ ] Undo reverts slide reordering
- [ ] Undo count shown in status bar

### Redo Operations
- [ ] **Ctrl+Y** redoes last undo
- [ ] **Ctrl+Shift+Z** redoes last undo
- [ ] Redo button works
- [ ] Redo count shown in status bar
- [ ] New action clears redo stack

### Button States
- [ ] Undo button disabled when no history
- [ ] Redo button disabled when no redo available

---

## Presentation Mode

### Entering Presentation Mode
- [ ] "Present" button enters presentation mode
- [ ] **F5** enters presentation mode
- [ ] Slide fills viewport
- [ ] Background is black
- [ ] Slide counter shows "X / Y"

### Navigation in Presentation Mode
- [ ] **Arrow Right** advances to next slide
- [ ] **Arrow Down** advances to next slide
- [ ] **Spacebar** advances to next slide
- [ ] **PageDown** advances to next slide
- [ ] **Arrow Left** goes to previous slide
- [ ] **Arrow Up** goes to previous slide
- [ ] **PageUp** goes to previous slide

### Exiting Presentation Mode
- [ ] **Escape** exits presentation mode
- [ ] Returns to editor view
- [ ] Current slide preserved

### Element Rendering in Presentation
- [ ] Text elements render correctly
- [ ] Images render correctly
- [ ] Shapes render correctly
- [ ] Font sizes scale with viewport
- [ ] Z-order respected

---

## Status Bar

- [ ] Shows "Slide X of Y"
- [ ] Shows "N element(s)"
- [ ] Shows "• X selected" when selection exists
- [ ] Shows "Undo: X | Redo: Y" counts

---

## Keyboard Shortcuts Summary

### File Operations
- [ ] **Ctrl+N** - New presentation
- [ ] **Ctrl+O** - Open presentation
- [ ] **Ctrl+S** - Save presentation
- [ ] **Ctrl+Shift+S** - Save As

### Edit Operations
- [ ] **Ctrl+Z** - Undo
- [ ] **Ctrl+Y** - Redo
- [ ] **Ctrl+Shift+Z** - Redo (alternative)
- [ ] **Ctrl+C** - Copy
- [ ] **Ctrl+X** - Cut
- [ ] **Ctrl+V** - Paste
- [ ] **Ctrl+D** - Duplicate
- [ ] **Ctrl+A** - Select all
- [ ] **Delete/Backspace** - Delete selected

### Element Operations
- [ ] **Arrow keys** - Nudge 1px
- [ ] **Shift+Arrow keys** - Nudge 10px
- [ ] **Escape** - Deselect / Exit mode

### Z-Ordering
- [ ] **Ctrl+]** - Bring forward
- [ ] **Ctrl+[** - Send backward
- [ ] **Ctrl+Shift+]** - Bring to front
- [ ] **Ctrl+Shift+[** - Send to back

### Formatting
- [ ] **Ctrl+B** - Toggle bold
- [ ] **Ctrl+I** - Toggle italic

### Navigation
- [ ] **PageUp** - Previous slide
- [ ] **PageDown** - Next slide
- [ ] **F5** - Start presentation

---

## Edge Cases

### Empty Presentation
- [ ] Can save empty presentation
- [ ] Can load empty presentation

### Large Content
- [ ] Very long text handled gracefully
- [ ] Large images scaled appropriately
- [ ] Many elements (20+) perform well
- [ ] Many slides (50+) perform well

### Special Characters
- [ ] Unicode characters supported
- [ ] Emoji support (if available)
- [ ] Special characters (©, ®, etc.)

### Error Handling
- [ ] Cancel save dialog doesn't crash
- [ ] Cancel open dialog doesn't crash
- [ ] Invalid file shows error message
- [ ] Browser fallback (localStorage) works

### Unsaved Changes
- [ ] Warning on new with unsaved changes
- [ ] Can cancel to keep editing
- [ ] Can proceed to discard changes

---

## Cross-Browser (if applicable)

- [ ] Works in Chrome
- [ ] Works in Firefox
- [ ] Works in Edge

---

## Performance

- [ ] App loads quickly
- [ ] Dragging is smooth
- [ ] Resizing is smooth
- [ ] Undo/redo is instant
- [ ] Slide switching is fast
- [ ] Save/load completes promptly

---

## Test Results Summary

**Date Tested**: _______________

**Tester**: _______________

**Total Tests**: _____ / _____

**Pass Rate**: _____%

### Critical Issues Found:
1.
2.
3.

### Minor Issues Found:
1.
2.
3.

### Notes:


### Overall Assessment:
- [ ] Ready for production
- [ ] Needs minor fixes
- [ ] Needs major fixes

---

## Features Implemented

- [x] Slide management (add, delete, duplicate, reorder)
- [x] Slide templates (5 presets)
- [x] Element creation (text, shapes, images)
- [x] Element manipulation (drag, resize, delete)
- [x] Text formatting (font, size, bold, italic, color, alignment)
- [x] Lists (bullet, numbered)
- [x] Clipboard operations (copy, cut, paste, duplicate)
- [x] Z-ordering (bring to front, send to back, forward, backward)
- [x] Multi-selection with alignment tools
- [x] Undo/Redo system
- [x] Keyboard shortcuts (20+ shortcuts)
- [x] Speaker notes
- [x] Grid and snap-to-grid
- [x] Presentation mode with navigation
- [x] File operations (new, open, save, save as)
- [x] Export to HTML

## Features for Future Implementation

- [ ] Slide transitions (fade, slide, zoom)
- [ ] Element animations (entrance, exit, emphasis)
- [ ] Master slides / layouts
- [ ] Themes and color schemes
- [ ] Export to PPTX
- [ ] Export to PDF
- [ ] Presenter view with notes
- [ ] Find & replace text
- [ ] Tables support
- [ ] Charts and graphs
- [ ] Audio/video embedding
- [ ] Hyperlinks
- [ ] Collaboration features
- [ ] Version history
