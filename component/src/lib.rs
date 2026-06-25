wit_bindgen::generate!({ world: "repro", path: "wit" });

struct Component;

impl Guest for Component {
    fn run(n: u32) {
        for _ in 0..n {
            tick();
        }
    }
}

export!(Component);
