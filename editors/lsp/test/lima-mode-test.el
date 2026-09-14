;;; lima-mode-test.el --- Tests for lima-mode -*- lexical-binding: t; -*-

(require 'ert)
(require 'lima-mode)

(defconst lima-test--document
  (concat
   "title: ${site.name} / $(partial.name)\n"
   "quoted: \"${site.name}\" '$(partial.name)'\n"
   "plain: YAML's apostrophe does not start a string\n"
   "body: | # comment\n"
   "  ^^continued\n"
   "not-a-block: >\n"
   "double: \"\\n \\q\"\n"
   "single: '\\\\ \\''\n"
   "flow: [true, null, 12, 2026-09-14, {name: ${title}}]\n"
   "commented: value # ${ignored}\n"
   "tight-comment: hello#${should_be_comment}\n"
   "escaped-hash: hello\\#literal\n"
   "quoted-hash: \"hello#not-a-comment\"\n"
   "escaped-then-comment: hello\\#literal#${actual_comment}\n"
   "quoted-then-comment: \"hello#literal\"#${outer_comment}\n"))

(defun lima-test--face-at (text occurrence &optional offset)
  "Return face at OFFSET within OCCURRENCE of TEXT after fontification."
  (with-temp-buffer
    (insert text)
    (lima-mode)
    (font-lock-ensure)
    (goto-char (point-min))
    (search-forward occurrence)
    (get-text-property (+ (match-beginning 0) (or offset 0)) 'face)))

(ert-deftest lima-mode-associates-lima-files ()
  (should (eq (cdr (assoc "\\.lima\\'" auto-mode-alist)) 'lima-mode)))

(ert-deftest lima-mode-highlights-core-and-reference-syntax ()
  (should (eq (lima-test--face-at lima-test--document "title")
              'font-lock-variable-name-face))
  (should (eq (lima-test--face-at lima-test--document "${site.name}")
              'font-lock-variable-name-face))
  (should (eq (lima-test--face-at lima-test--document "$(partial.name)")
              'font-lock-preprocessor-face))
  (should (eq (lima-test--face-at lima-test--document "| #" 0)
              'font-lock-keyword-face))
  (should (eq (lima-test--face-at lima-test--document "^^continued")
              'font-lock-keyword-face))
  (should (eq (lima-test--face-at lima-test--document "true")
              'font-lock-constant-face))
  (should (eq (lima-test--face-at lima-test--document "null")
              'font-lock-constant-face))
  (should (eq (lima-test--face-at lima-test--document "12")
              'font-lock-constant-face))
  (should (eq (lima-test--face-at lima-test--document "2026-09-14")
              'font-lock-constant-face))
  (should-not (eq (lima-test--face-at lima-test--document ">")
                  'font-lock-keyword-face)))

(ert-deftest lima-mode-keeps-references-in-quotes-literal ()
  (should (eq (lima-test--face-at lima-test--document
                                  "\"${site.name}\"" 1)
              'font-lock-string-face))
  (should (eq (lima-test--face-at lima-test--document
                                  "'$(partial.name)'" 1)
              'font-lock-string-face)))

(ert-deftest lima-mode-guards-apostrophes-in-running-text ()
  (should-not (eq (lima-test--face-at lima-test--document "YAML's" 4)
                  'font-lock-string-face))
  (should-not (eq (lima-test--face-at lima-test--document "apostrophe")
                  'font-lock-string-face)))

(ert-deftest lima-mode-highlights-escapes-and-comments ()
  (should (eq (lima-test--face-at lima-test--document "\\n")
              'font-lock-constant-face))
  (should (eq (lima-test--face-at lima-test--document "\\q")
              'font-lock-warning-face))
  (should (eq (lima-test--face-at lima-test--document "\\\\ ")
              'font-lock-constant-face))
  (should (eq (lima-test--face-at lima-test--document "\\''")
              'font-lock-constant-face))
  (should (eq (lima-test--face-at lima-test--document "# comment")
              'font-lock-comment-face))
  (should (eq (lima-test--face-at lima-test--document "${ignored}")
              'font-lock-comment-face)))

(ert-deftest lima-mode-comments-do-not-require-leading-whitespace ()
  (should (eq (lima-test--face-at lima-test--document
                                  "#${should_be_comment}")
              'font-lock-comment-face))
  (should (eq (lima-test--face-at lima-test--document
                                  "${should_be_comment}")
              'font-lock-comment-face))
  (should-not (eq (lima-test--face-at lima-test--document "#literal")
                  'font-lock-comment-face))
  (should (eq (lima-test--face-at lima-test--document
                                  "#not-a-comment")
              'font-lock-string-face))
  (should (eq (lima-test--face-at lima-test--document "${actual_comment}")
              'font-lock-comment-face))
  (should (eq (lima-test--face-at lima-test--document "${outer_comment}")
              'font-lock-comment-face)))

;;; lima-mode-test.el ends here
