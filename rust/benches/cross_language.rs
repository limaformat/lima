//! Cross-language Lima benchmark counterpart to `js/bench/index.ts` and
//! `go/bench`. Not a CI gate. Run `cargo bench --bench cross_language --
//! --json` for machine-readable results.
use lima::value::LimaValue;
use lima::{parse_core, parse_references, ReferencesOptions};
use std::{env, hint::black_box, time::Instant};
const SAMPLES: usize = 7;
struct R {
    name: String,
    it: usize,
    med: f64,
    p95: f64,
    min: f64,
    max: f64,
    ops: f64,
}
fn bench(name: &str, mut f: impl FnMut(), it: usize) -> R {
    for _ in 0..it.min(50) {
        f()
    }
    let mut xs = Vec::new();
    for _ in 0..SAMPLES {
        let s = Instant::now();
        for _ in 0..it {
            f()
        }
        xs.push(s.elapsed().as_secs_f64() * 1e6 / it as f64)
    }
    xs.sort_by(|a, b| a.partial_cmp(b).unwrap());
    let med = xs[xs.len() / 2];
    R {
        name: name.into(),
        it,
        med,
        p95: xs[((xs.len() as f64 * 0.95).ceil() as usize - 1).min(xs.len() - 1)],
        min: xs[0],
        max: *xs.last().unwrap(),
        ops: 1e6 / med,
    }
}
fn main() {
    let json = env::args().any(|a| a == "--json");
    let typical="title: My Blog Post\nslug: my-blog-post\ndate: 2024-03-01T09:00:00Z\ndraft: false\nauthor: Alice\ntags: [javascript, webdev, tutorial]\nexcerpt: A short excerpt about the post, nothing fancy.\nreadingTime: 4.5\ncategory: Engineering\n";
    let mut cases:Vec<(String,String,Option<Vec<(String,LimaValue)>>,usize)>=vec![("core typical".into(),typical.into(),None,20000),("references no references".into(),typical.into(),Some(vec![]),20000),("references small document".into(),"siteName: My Site\ntitle: Hello ($siteName)!\nbyline: Written by ($author)\nauthor: Alice\ntagline: (%tagline)\n".into(),Some(vec![("tagline".into(),LimaValue::String("Welcome".into()))]),20000)];
    let mut deep = "a:\n".to_string();
    for i in 1..=15 {
        deep += &format!("{}k:\n", "  ".repeat(i))
    }
    deep += &format!("{}leaf: v\n", "  ".repeat(16));
    cases.push(("core maximum nesting depth".into(), deep, None, 20000));
    let mut keys = String::new();
    for i in 0..128 {
        keys += &format!("k{i}: value{i}\n")
    }
    cases.push(("core 128 top-level keys".into(), keys, None, 5000));
    let mut wide = "items:\n".to_string();
    for i in 0..1000 {
        wide += &format!("  - item{i}\n")
    }
    cases.push(("core wide block array".into(), wide, None, 2000));
    let mut interp = String::new();
    for i in 0..20 {
        interp += &format!("k{i}: v{i}\n")
    }
    interp += "summary: ";
    for i in 0..20 {
        interp += &format!("($k{i}) ")
    }
    interp += "\n";
    cases.push((
        "references interpolation-heavy".into(),
        interp,
        Some(vec![]),
        10000,
    ));
    let big = LimaValue::Array((0..1999).map(LimaValue::Int).collect());
    let mut pd = String::new();
    for i in 0..16 {
        pd += &format!("k{i}: (%big)\n")
    }
    cases.push((
        "references large partial copies".into(),
        pd,
        Some(vec![("big".into(), big)]),
        200,
    ));
    for n in [100, 200, 400, 800, 1600] {
        let mut d = "root:\n".to_string();
        for i in 0..n {
            d += &format!("  k{i}: v{i}\n")
        }
        cases.push((format!("scaling keys/{n}"), d, None, (20000 / n).max(50)))
    }
    for n in [50, 100, 200, 400, 800, 1600, 3200] {
        let mut d = "base: 42\nrefs:\n".to_string();
        for i in 0..n {
            d += &format!("  k{i}: ($base)\n")
        }
        if d.len() <= 65536 {
            cases.push((
                format!("scaling references/{n}"),
                d,
                Some(vec![]),
                (5000 / n).max(30),
            ))
        }
    }
    let mut rs = Vec::new();
    for (name, doc, partials, it) in cases {
        let r = if let Some(p) = partials {
            bench(
                &name,
                || {
                    black_box(
                        parse_references(
                            black_box(&doc),
                            ReferencesOptions {
                                partials: p.clone(),
                                strict: false,
                            },
                        )
                        .unwrap(),
                    );
                },
                it,
            )
        } else {
            bench(
                &name,
                || {
                    black_box(parse_core(black_box(&doc), false).unwrap());
                },
                it,
            )
        };
        if !json {
            println!(
                "{:<45} median {:>9.2} us/op p95 {:>9.2} {:>9.0} ops/sec",
                r.name, r.med, r.p95, r.ops
            )
        }
        rs.push(r)
    }
    if json {
        print!("[");
        for (i, r) in rs.iter().enumerate() {
            if i > 0 {
                print!(",")
            }
            print!("{{\"name\":{:?},\"implementation\":\"rust-lima\",\"iterations\":{},\"samples\":{},\"medianUs\":{},\"p95Us\":{},\"minUs\":{},\"maxUs\":{},\"opsPerSec\":{}}}",r.name,r.it,SAMPLES,r.med,r.p95,r.min,r.max,r.ops)
        }
        println!("]")
    }
}
