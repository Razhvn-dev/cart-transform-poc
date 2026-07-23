use shopify_function::prelude::*;
use std::process;

pub mod run;
pub mod shared_core;

#[typegen("schema.graphql")]
pub mod schema {
    #[query(
        "src/run.graphql",
        custom_scalar_overrides = {
            "Input.cart.lines.cost.amountPerQuantity.amount" => ::std::string::String,
            "Input.cart.lines.merchandise.product.prebuiltExpandProjectionMetafield.jsonValue" => ::shopify_function::scalars::JsonValue,
        }
    )]
    pub mod run {}
}

fn main() {
    log!("Please invoke a named export.");
    process::abort();
}
