;;; lima-mode.el --- Major mode for Lima data files -*- lexical-binding: t; -*-

;; Copyright (C) 2026 Lima contributors
;; SPDX-License-Identifier: ISC

;;; Commentary:

;; Syntax highlighting for Lima Core 1.0 and active References 2.0 tokens.

;;; Code:

(require 'font-lock)

(defgroup lima nil
  "Editing Lima data files."
  :group 'languages)

;; GENERATED:emacs-key
(defconst lima--key-regexp
  "[a-zA-Z0-9_][a-zA-Z0-9_:-]*\\|'[^']*'\\|\"\\(?:\\\\.\\|[^\"\\\\]\\)*\"")

;; GENERATED:emacs-document-reference
(defconst lima--document-reference-regexp
  "\\${[a-zA-Z0-9_][a-zA-Z0-9_:-]*\\(?:\\.[a-zA-Z0-9_][a-zA-Z0-9_:-]*\\)*}")

;; GENERATED:emacs-partial-reference
(defconst lima--partial-reference-regexp
  "\\$([a-zA-Z0-9_][a-zA-Z0-9_:/-]*\\(?:\\.[a-zA-Z0-9_][a-zA-Z0-9_:-]*\\)*)")

(defconst lima--mapping-key-regexp
  (concat "^\\([ \t]*\\)\\(" lima--key-regexp
          "\\)\\([ \t]*\\)\\(:\\)\\(?:[ \t]\\|$\\)"))

(defconst lima--flow-mapping-key-regexp
  (concat "\\(?:[{,][ \t]*\\)\\(" lima--key-regexp
          "\\)\\([ \t]*\\)\\(:\\)[ \t]"))

(defconst lima--double-string-regexp
  "\\(?:^\\|[^[:word:]_]\\)\\(\"\\(?:\\\\.\\|[^\"\\\\]\\)*\\(?:\"\\|$\\)\\)")

(defconst lima--single-string-regexp
  "\\(?:^\\|[^[:word:]_]\\)\\('\\(?:\\\\\\\\\\|\\\\'\\|[^']\\)*\\(?:'\\|$\\)\\)")

(defconst lima--double-escape-regexp
  "\\\\\\(?:[\"\\\\/nrtbf]\\|u[0-9a-fA-F]\\{4\\}\\|U[0-9a-fA-F]\\{8\\}\\|x[0-9a-fA-F]\\{2\\}\\)")

(defconst lima--date-regexp
  (concat
   "\\(?:^\\|[^[:word:]-]\\)\\("
   "[0-9]\\{4\\}-[0-9]\\{2\\}-[0-9]\\{2\\}"
   "\\(?:[T ][0-9]\\{2\\}:[0-9]\\{2\\}"
   "\\(?::[0-9]\\{2\\}\\)?"
   "\\(?:Z\\|[+-][0-9]\\{2\\}:[0-9]\\{2\\}\\)?\\)?"
   "\\|[0-9]\\{1,2\\}[./][0-9]\\{1,2\\}[./][0-9]\\{4\\}"
   "\\(?:[T ][0-9]\\{2\\}:[0-9]\\{2\\}"
   "\\(?::[0-9]\\{2\\}\\)?\\)?"
   "\\)\\(?:$\\|[^[:word:]]\\)"))

(defconst lima--number-regexp
  (concat
   "\\(?:^\\|[^[:word:].-]\\)\\("
   "-?\\(?:0\\|[1-9][0-9]*\\)"
   "\\(?:\\.[0-9]+\\)?\\(?:[eE][+-]?[0-9]+\\)?"
   "\\)\\(?:$\\|[^[:word:].-]\\)"))

(defun lima--context-at (position)
  "Return the lexical context at POSITION on its line.
The result is `double', `single', `comment', or nil.  Lima quotes only open
at a value boundary, so apostrophes in words such as YAML's stay literal."
  (save-excursion
    (goto-char (line-beginning-position))
    (let ((context nil))
      (while (< (point) position)
        (let ((character (char-after))
              (next (char-after (1+ (point))))
              (previous (char-before)))
          (cond
           ((eq context 'comment)
            (goto-char position))
           ((eq context 'double)
            (cond
             ((eq character ?\\)
              (forward-char (if next 2 1)))
             ((eq character ?\")
              (setq context nil)
              (forward-char 1))
             (t (forward-char 1))))
           ((eq context 'single)
            (cond
             ((and (eq character ?\\) (memq next '(?\\ ?')))
              (forward-char 2))
             ((eq character ?')
              (setq context nil)
              (forward-char 1))
             (t (forward-char 1))))
           ((and (eq character ?#)
                 (not (eq previous ?\\)))
            (setq context 'comment))
           ((and (memq character '(?\" ?'))
                 (or (null previous)
                     (not (string-match-p "[[:word:]_]"
                                          (char-to-string previous)))))
            (setq context (if (eq character ?\") 'double 'single))
            (forward-char 1))
           (t (forward-char 1)))))
      context)))

(defun lima--match-in-context (regexp wanted-context limit)
  "Search REGEXP up to LIMIT until it occurs in WANTED-CONTEXT."
  (let (found)
    (while (and (not found) (re-search-forward regexp limit t))
      (when (eq (lima--context-at (match-beginning 0)) wanted-context)
        (setq found t)))
    found))

(defun lima--match-document-reference (limit)
  "Find the next active document reference before LIMIT."
  (lima--match-in-context lima--document-reference-regexp nil limit))

(defun lima--match-partial-reference (limit)
  "Find the next active partial reference before LIMIT."
  (lima--match-in-context lima--partial-reference-regexp nil limit))

(defun lima--match-double-escape (limit)
  "Find the next valid double-quoted escape before LIMIT."
  (lima--match-in-context lima--double-escape-regexp 'double limit))

(defun lima--match-unknown-double-escape (limit)
  "Find the next invalid double-quoted escape before LIMIT."
  (let (found)
    (while (and (not found) (re-search-forward "\\\\." limit t))
      (let ((start (match-beginning 0)))
        (when (and (eq (lima--context-at start) 'double)
                   (not (save-excursion
                          (goto-char start)
                          (looking-at lima--double-escape-regexp))))
          (setq found t))))
    found))

(defun lima--match-single-escape (limit)
  "Find the next Lima single-quoted escape before LIMIT."
  (lima--match-in-context "\\\\\\(?:\\\\\\|'\\)" 'single limit))

(defun lima--match-comment (limit)
  "Find the next unescaped comment outside quotes before LIMIT."
  (let (found)
    (while (and (not found) (re-search-forward "#" limit t))
      (let ((start (match-beginning 0)))
        (when (and (not (eq (char-before start) ?\\))
                   (null (lima--context-at start)))
          (set-match-data (list start (min limit (line-end-position))))
          (setq found t))))
    found))

(defconst lima-font-lock-keywords
  `((,lima--mapping-key-regexp
     (2 font-lock-variable-name-face)
     (4 font-lock-builtin-face))
    ("^[ \t]*\\(-\\)\\(?:[ \t]\\|$\\)"
     (1 font-lock-builtin-face))
    ("^[ \t]*\\(\\^\\^\\)"
     (1 font-lock-keyword-face))
    (":\\s-+\\(|\\)[ \t]*\\(?:\\(#.*\\)\\)?$"
     (1 font-lock-keyword-face)
     (2 font-lock-comment-face t t))
    (,lima--flow-mapping-key-regexp
     (1 font-lock-variable-name-face)
     (3 font-lock-builtin-face))
    (lima--match-document-reference
     (0 font-lock-variable-name-face))
    (lima--match-partial-reference
     (0 font-lock-preprocessor-face))
    ("[][{}]" (0 font-lock-builtin-face))
    ("," (0 font-lock-builtin-face))
    ("\\(?:^\\|[^[:word:]-]\\)\\(null\\|~\\)\\(?:$\\|[^[:word:]-]\\)"
     (1 font-lock-constant-face))
    ("\\(?:^\\|[^[:word:]-]\\)\\(true\\|false\\)\\(?:$\\|[^[:word:]-]\\)"
     (1 font-lock-constant-face))
    (,lima--date-regexp
     (1 font-lock-constant-face))
    (,lima--number-regexp
     (1 font-lock-constant-face))
    (,lima--double-string-regexp
     (1 font-lock-string-face t))
    (,lima--single-string-regexp
     (1 font-lock-string-face t))
    (lima--match-double-escape
     (0 font-lock-constant-face t))
    (lima--match-unknown-double-escape
     (0 font-lock-warning-face t))
    (lima--match-single-escape
     (0 font-lock-constant-face t))
    (lima--match-comment
     (0 font-lock-comment-face t)))
  "Font-lock rules for `lima-mode'.")

;;;###autoload
(define-derived-mode lima-mode prog-mode "Lima"
  "Major mode for editing Lima data files."
  :group 'lima
  (setq-local font-lock-defaults '(lima-font-lock-keywords nil nil))
  (setq-local comment-start "# ")
  (setq-local comment-end ""))

;;;###autoload
(add-to-list 'auto-mode-alist '("\\.lima\\'" . lima-mode))

(provide 'lima-mode)

;;; lima-mode.el ends here
