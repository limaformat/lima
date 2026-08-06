package bench

import (
	"fmt"
	"strings"

	lima "github.com/limaformat/lima/go"
)

type Scenario struct {
	Name, Document string
	Partials       map[string]lima.Value
}

var typical = `title: My Blog Post
slug: my-blog-post
date: 2024-03-01T09:00:00Z
draft: false
author: Alice
tags: [javascript, webdev, tutorial]
excerpt: A short excerpt about the post, nothing fancy.
readingTime: 4.5
category: Engineering
`

func YAMLScenarios() []Scenario {
	wide := "tags:\n"
	for i := 0; i < 50; i++ {
		wide += fmt.Sprintf("  - tag%d\n", i)
	}
	authors := "authors:\n"
	for i := 0; i < 10; i++ {
		authors += fmt.Sprintf("  - name: Author %d\n    email: author%d@example.com\n", i, i)
	}
	mixed := ""
	for i := 0; i < 50; i++ {
		switch i % 4 {
		case 0:
			mixed += fmt.Sprintf("key%d: %d\n", i, i)
		case 1:
			mixed += fmt.Sprintf("key%d: value %d\n", i, i)
		case 2:
			mixed += fmt.Sprintf("key%d: %t\n", i, i%2 == 0)
		default:
			mixed += fmt.Sprintf("key%d: 2024-0%d-01\n", i, (i%9)+1)
		}
	}
	return []Scenario{
		{"typical blog post (9 keys, flat)", typical, nil},
		{"nested author + block array of tags", "title: My Blog Post\ndate: 2024-03-01\ndraft: false\nauthor:\n  name: Alice\n  email: alice@example.com\ntags:\n  - javascript\n  - webdev\n  - tutorial\n", nil},
		{"SEO-heavy frontmatter (nested mapping, many string fields)", "title: My Blog Post\ndescription: A longer description used for SEO meta tags and social previews.\nseo:\n  title: My Blog Post | My Site\n  description: A longer description used for SEO meta tags and social previews.\n  image: /images/my-blog-post/cover.png\n  canonical: https://example.com/blog/my-blog-post\nsocial:\n  twitter: \"@example\"\n  ogType: article\n", nil},
		{"wide block array (50 tags)", wide, nil},
		{"list of author objects (block sequence of mappings)", authors, nil},
		{"many scalar keys, mixed types (50 keys)", mixed, nil},
	}
}

func InternalScenarios() []Scenario {
	deep := "a:\n"
	for i := 1; i <= 15; i++ {
		deep += strings.Repeat("  ", i) + "k:\n"
	}
	deep += strings.Repeat("  ", 16) + "leaf: v\n"
	keys := ""
	for i := 0; i < 128; i++ {
		keys += fmt.Sprintf("k%d: value%d\n", i, i)
	}
	wide := "items:\n"
	for i := 0; i < 1000; i++ {
		wide += fmt.Sprintf("  - item%d\n", i)
	}
	interp := ""
	for i := 0; i < 20; i++ {
		interp += fmt.Sprintf("k%d: v%d\n", i, i)
	}
	interp += "summary: "
	for i := 0; i < 20; i++ {
		interp += fmt.Sprintf("($k%d) ", i)
	}
	interp += "\n"
	big := make(lima.Array, 1999)
	for i := range big {
		big[i] = lima.Int64(i)
	}
	partialDoc := ""
	for i := 0; i < 16; i++ {
		partialDoc += fmt.Sprintf("k%d: (%%big)\n", i)
	}
	return []Scenario{
		{"core typical", typical, nil}, {"references no references", typical, map[string]lima.Value{}},
		{"references small document", "siteName: My Site\ntitle: Hello ($siteName)!\nbyline: Written by ($author)\nauthor: Alice\ntagline: (%tagline)\n", map[string]lima.Value{"tagline": lima.String("Welcome")}},
		{"core maximum nesting depth", deep, nil}, {"core 128 top-level keys", keys, nil}, {"core wide block array", wide, nil},
		{"references interpolation-heavy", interp, map[string]lima.Value{}}, {"references large partial copies", partialDoc, map[string]lima.Value{"big": big}},
	}
}
