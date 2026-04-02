# Word Processor Testing Checklist

## 🎯 File Operations

### New Document
- [ ] Click "New" button creates a blank document
- [ ] Warns about unsaved changes if current doc has changes
- [ ] Sets filename to "Untitled Document"
- [ ] Clears all content
- [ ] **Keyboard**: Test creating new doc while editing

### Save Document
- [ ] **Ctrl+S** triggers save
- [ ] First save shows save dialog
- [ ] Can save as .html format
- [ ] Can save as .txt format
- [ ] Can save as .md format
- [ ] Subsequent saves overwrite existing file
- [ ] Status changes from "(unsaved)" to "(saved)"
- [ ] Filename updates in header
- [ ] Loading indicator appears during save

### Save As
- [ ] Opens dialog even if file already saved
- [ ] Can choose different format
- [ ] Can choose different location
- [ ] Updates filename and path

### Open Document
- [ ] **Ctrl+O** triggers open dialog
- [ ] Can open .html files (preserves formatting)
- [ ] Can open .txt files (converts to paragraphs)
- [ ] Can open .docx files (imports formatting)
- [ ] Can open .rtf files (imports formatting)
- [ ] Can open .md files (converts markdown)
- [ ] Loading indicator appears during load
- [ ] DOCX with images imports correctly
- [ ] DOCX with tables imports correctly
- [ ] DOCX with lists (bullet/numbered) imports correctly

### Export HTML
- [ ] Creates standalone HTML file
- [ ] File includes all styling
- [ ] Downloaded file opens in browser correctly
- [ ] Tables render properly
- [ ] Images are embedded (base64)

### Print
- [ ] **Ctrl+P** triggers print
- [ ] Print button opens print dialog
- [ ] Print preview shows correct formatting
- [ ] Tables print correctly
- [ ] Page breaks work properly

---

## ✍️ Text Formatting

### Font Controls
- [ ] Font family dropdown shows all options
- [ ] Changing font family applies to selected text
- [ ] Changing font family applies to new text
- [ ] Font size dropdown works (8pt - 72pt)
- [ ] Font size applies to selection
- [ ] Font persists after save/load

### Bold, Italic, Underline
- [ ] **Ctrl+B** toggles bold
- [ ] Bold button works with mouse
- [ ] Bold button highlights when active
- [ ] **Ctrl+I** toggles italic
- [ ] Italic button works
- [ ] **Ctrl+U** toggles underline
- [ ] Underline button works
- [ ] Can combine B+I+U on same text
- [ ] Formatting persists after save/load

### Strikethrough
- [ ] Strikethrough button toggles
- [ ] Button highlights when active
- [ ] Works with selected text
- [ ] Works with new text

### Subscript & Superscript
- [ ] Subscript button (X₂) works
- [ ] Superscript button (X²) works
- [ ] Can't have both sub and super simultaneously
- [ ] Useful for H₂O, E=mc²

### Text Color
- [ ] Color picker opens
- [ ] Changing color applies to selected text
- [ ] Default color shown correctly
- [ ] Multiple colors can be used in same document

### Highlight Color
- [ ] Highlight color picker appears (if TiptapHighlight available)
- [ ] Highlight applies to selected text
- [ ] Can change highlight color
- [ ] Multiple highlight colors in same doc

---

## 📝 Paragraph Formatting

### Headings
- [ ] H1 button creates Heading 1
- [ ] H2 button creates Heading 2
- [ ] H3 button creates Heading 3
- [ ] P button converts back to paragraph
- [ ] Active heading button highlights
- [ ] Headings have appropriate font sizes

### Text Alignment
- [ ] Left align button works
- [ ] Center align button works
- [ ] Right align button works
- [ ] Justify align button works
- [ ] Active alignment button highlights
- [ ] Alignment persists after save

### Line Spacing
- [ ] Single spacing option works
- [ ] 1.5 spacing option works
- [ ] Double spacing option works
- [ ] Spacing applies to paragraph
- [ ] Spacing visible in editor

### Lists
- [ ] Bullet list button creates unordered list
- [ ] Numbered list button creates ordered list
- [ ] Can toggle between bullet and numbered
- [ ] Enter creates new list item
- [ ] Enter twice exits list
- [ ] **Indent controls**:
  - [ ] Increase indent button (→) works
  - [ ] Decrease indent button (←) works
  - [ ] Creates nested lists
  - [ ] Tab key increases indent (if supported)

### Blockquote
- [ ] Blockquote button creates quote
- [ ] Quote has distinct styling
- [ ] Can toggle blockquote on/off

---

## 🖼️ Images

### Insert Image
- [ ] Image button opens file picker
- [ ] Can select PNG images
- [ ] Can select JPG images
- [ ] Can select GIF images
- [ ] Image appears in document
- [ ] Image embedded as base64

### Image Selection
- [ ] Clicking image selects it
- [ ] Selected image has **blue outline** (3px solid)
- [ ] Selected image has **visible resize handles** (8 handles)
- [ ] Clicking elsewhere deselects image

### Image Resize
- [ ] Corner handles maintain aspect ratio
- [ ] Edge handles resize in one dimension
- [ ] All 8 handles work (NW, N, NE, E, SE, S, SW, W)
- [ ] Can resize to minimum 50x30px
- [ ] Resize is smooth and responsive
- [ ] Marks document as unsaved after resize

### Image Delete
- [ ] **Delete** key removes selected image
- [ ] **Backspace** key removes selected image
- [ ] Delete doesn't work when typing in input field
- [ ] Image removed from document completely

---

## 📊 Tables

### Create Table
- [ ] Table button inserts 3x3 table
- [ ] Table has header row
- [ ] Table has borders
- [ ] Can type in cells

### Table Editing (when table selected)
- [ ] **+Col←** adds column before
- [ ] **+Col→** adds column after
- [ ] **-Col** deletes current column
- [ ] **+Row↑** adds row before
- [ ] **+Row↓** adds row after
- [ ] **-Row** deletes current row
- [ ] **-Table** deletes entire table
- [ ] Table controls only appear when cursor in table

### Table Functionality
- [ ] Can format text inside cells
- [ ] Can add images to cells
- [ ] Tab moves to next cell
- [ ] Table saves/loads correctly
- [ ] DOCX tables import correctly

---

## 🔗 Links

### Insert Link
- [ ] **Ctrl+K** opens link dialog
- [ ] Link button opens dialog
- [ ] Can enter URL
- [ ] Can enter link text (optional)
- [ ] Enter key submits
- [ ] Link appears with blue color/underline
- [ ] Link doesn't open on click (edit mode)

### Edit Link
- [ ] Clicking on existing link shows dialog
- [ ] Dialog pre-fills with current URL
- [ ] Can change URL
- [ ] **Remove Link** button appears
- [ ] Remove link button works

### Link Persistence
- [ ] Links save correctly
- [ ] Links load correctly
- [ ] Links export in HTML

---

## 🔍 Find & Replace

### Find
- [ ] **Ctrl+F** opens dialog
- [ ] Find button opens dialog
- [ ] Can type search term
- [ ] **Enter** key searches
- [ ] Shows match count
- [ ] Case sensitive checkbox works
- [ ] Finds text in document

### Replace
- [ ] Replace button replaces first match
- [ ] Replace All button replaces all matches
- [ ] Case sensitive affects replace
- [ ] Can replace with empty string
- [ ] Match count updates after replace

### Dialog
- [ ] Dialog centered on screen
- [ ] Overlay dims background
- [ ] Clicking overlay closes dialog
- [ ] Close button closes dialog
- [ ] Can search multiple times
- [ ] Can replace multiple times

---

## ⌨️ Keyboard Shortcuts

Test all keyboard shortcuts work:
- [ ] **Ctrl+S** - Save
- [ ] **Ctrl+O** - Open
- [ ] **Ctrl+P** - Print
- [ ] **Ctrl+F** - Find & Replace
- [ ] **Ctrl+K** - Insert Link
- [ ] **Ctrl+B** - Bold
- [ ] **Ctrl+I** - Italic
- [ ] **Ctrl+U** - Underline
- [ ] **Ctrl+Z** - Undo
- [ ] **Ctrl+Y** - Redo
- [ ] **Ctrl+Shift+Z** - Redo (alternative)

### Mac Testing (if available)
- [ ] **Cmd+S** - Save
- [ ] **Cmd+O** - Open
- [ ] **Cmd+P** - Print
- [ ] All other Cmd shortcuts work

---

## ↩️ Undo/Redo

- [ ] Undo button works
- [ ] Redo button works
- [ ] **Ctrl+Z** undoes
- [ ] **Ctrl+Y** redoes
- [ ] Button disables when can't undo/redo
- [ ] Can undo formatting changes
- [ ] Can undo text entry
- [ ] Can undo image insertion
- [ ] Can undo table operations
- [ ] Undo history survives across edits

---

## 💾 File Format Support

### HTML Files
- [ ] Save as .html works
- [ ] Load .html preserves formatting
- [ ] Bold/italic/underline preserved
- [ ] Colors preserved
- [ ] Tables preserved
- [ ] Images preserved (base64)
- [ ] Links preserved

### Text Files
- [ ] Save as .txt removes formatting
- [ ] Load .txt creates paragraphs
- [ ] Line breaks become paragraphs

### Markdown Files
- [ ] Save as .md converts HTML to markdown
- [ ] Headers convert (# ## ###)
- [ ] Bold converts (**)
- [ ] Italic converts (*)
- [ ] Lists convert
- [ ] Load .md converts markdown to HTML
- [ ] Markdown formatting renders correctly

### DOCX Files (Import Only)
- [ ] Basic text imports
- [ ] **Bold** text imports
- [ ] *Italic* text imports
- [ ] <u>Underline</u> imports
- [ ] Font colors import
- [ ] Font sizes import
- [ ] Headings import correctly
- [ ] Bullet lists import
- [ ] Numbered lists import
- [ ] Tables import with structure
- [ ] Images import and display
- [ ] Complex documents import without errors

### RTF Files (Import Only)
- [ ] Basic text imports
- [ ] Bold/italic/underline import
- [ ] Paragraphs preserved

---

## 🎨 User Interface

### Loading States
- [ ] Loading indicator shows during save
- [ ] Loading indicator shows during open
- [ ] Loading indicator shows during DOCX parse
- [ ] User can't interact during loading
- [ ] Loading clears after operation completes

### Status Bar
- [ ] Character count updates in real-time
- [ ] Word count updates in real-time
- [ ] Selected character count shows when text selected
- [ ] Counts are accurate

### Toolbar
- [ ] All buttons visible
- [ ] Active formatting buttons highlight (blue)
- [ ] Disabled buttons appear disabled
- [ ] Tooltips show on hover (with keyboard shortcuts)
- [ ] Toolbar doesn't overflow on medium screens
- [ ] Toolbar wraps appropriately

### File Info Display
- [ ] Filename shown in header
- [ ] File path shown (truncated if long)
- [ ] "(saved)" shown when saved
- [ ] "(unsaved)" shown in red when modified

---

## ♿ Accessibility

### ARIA Labels
- [ ] All buttons have aria-label
- [ ] Image upload input has label
- [ ] Dropdowns have labels
- [ ] Color pickers have labels

### Keyboard Navigation
- [ ] Can tab through toolbar
- [ ] Can activate buttons with Enter
- [ ] Can navigate dialogs with keyboard
- [ ] Focus visible on all elements

### Screen Reader Support
- [ ] Buttons announce correctly
- [ ] Form fields announce correctly
- [ ] Status changes announce

---

## 🐛 Edge Cases & Error Handling

### Empty Documents
- [ ] Can save empty document
- [ ] Can load empty document
- [ ] Empty paragraphs render correctly

### Large Documents
- [ ] Can handle 10+ pages
- [ ] Scrolling is smooth
- [ ] Performance acceptable with many images
- [ ] Save/load works with large files

### Special Characters
- [ ] Can type special characters (©, ®, ™, etc.)
- [ ] Emoji support (if available)
- [ ] Non-English characters (é, ñ, ü, etc.)
- [ ] Characters persist through save/load

### File Dialog Cancellation
- [ ] Canceling save dialog doesn't crash
- [ ] Canceling open dialog doesn't crash
- [ ] Can continue editing after cancel

### Unsaved Changes Warning
- [ ] Warning appears when creating new doc with unsaved changes
- [ ] Warning has clear message
- [ ] Can cancel to keep editing
- [ ] Can proceed to lose changes

### Browser Storage Fallback
- [ ] Save works in browser mode (localStorage)
- [ ] Load works in browser mode
- [ ] Data persists in localStorage

### Mixed Formatting
- [ ] Can have multiple fonts in same paragraph
- [ ] Can have multiple colors in same paragraph
- [ ] Can mix bold, italic, underline
- [ ] Nested lists work correctly
- [ ] Complex documents maintain structure

---

## 🎯 Real-World Scenarios

### Scenario 1: Create a Simple Letter
- [ ] Create new document
- [ ] Change font to Times New Roman
- [ ] Set font size to 12pt
- [ ] Type letter with paragraphs
- [ ] Add bold for emphasis
- [ ] Center align heading
- [ ] Save as .html
- [ ] Reopen file - formatting intact

### Scenario 2: Create a Report
- [ ] Add H1 title
- [ ] Add H2 section headings
- [ ] Create bullet list
- [ ] Create numbered list
- [ ] Insert table with data
- [ ] Add image
- [ ] Resize image
- [ ] Save and reload - everything preserved

### Scenario 3: Edit Existing DOCX
- [ ] Open .docx file with formatting
- [ ] Edit text while preserving formatting
- [ ] Add new content
- [ ] Save as .html
- [ ] Reopen - changes saved

### Scenario 4: Find & Replace
- [ ] Open document with repeated word
- [ ] Use Ctrl+F to find word
- [ ] See match count
- [ ] Replace all instances
- [ ] Verify all replaced

### Scenario 5: Print Preview
- [ ] Create multi-page document
- [ ] Add table and images
- [ ] Use Ctrl+P
- [ ] Verify print preview looks good
- [ ] Test actual printing (optional)

---

## 📋 Final Checks

### Cross-Browser Testing
- [ ] Works in Chrome
- [ ] Works in Firefox
- [ ] Works in Edge
- [ ] Works in Safari (if available)

### Performance
- [ ] App loads quickly
- [ ] Typing is responsive
- [ ] No lag when formatting
- [ ] File operations complete promptly

### Data Integrity
- [ ] No data loss on save/load
- [ ] Formatting preserved accurately
- [ ] Images don't corrupt
- [ ] Tables maintain structure
- [ ] Links remain clickable in exported HTML

### Polish
- [ ] No console errors
- [ ] No visual glitches
- [ ] Buttons have hover states
- [ ] Cursor changes appropriately
- [ ] Professional appearance

---

## ✅ Test Results Summary

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

## 🎉 Congratulations!

If all tests pass, you have a fully functional, professional-grade Word Processor with:
- ✅ Complete file format support
- ✅ Rich text editing
- ✅ Tables and images
- ✅ Find & replace
- ✅ Keyboard shortcuts
- ✅ Print functionality
- ✅ DOCX import
- ✅ Accessibility features
- ✅ Professional UI/UX

This rivals many commercial word processors! 🚀
