use super::schema;

const MASTER_KIT_VARIANT_ID: &str = "gid://shopify/ProductVariant/51505325605142";
const MASTER_KIT_DISPLAY_TITLE: &str = "Master Kit Test";
const BUNDLE_SCHEMA_VERSION: &str = "1";
const BUNDLE_DISCOUNT_BASIS_POINTS: i64 = 500;

const EFI_FUSION_LITE: &str = "gid://shopify/ProductVariant/51592538587414";
const EFI_KILLSHOT_2_PRO: &str = "gid://shopify/ProductVariant/51552319865110";
const FUEL_TEST: &str = "gid://shopify/ProductVariant/51505348346134";
const FUEL_TEST_2: &str = "gid://shopify/ProductVariant/51518319591702";
const IGNITION_BLACK_JACK: &str = "gid://shopify/ProductVariant/51592730706198";
const IGNITION_HIGH_ROLLER: &str = "gid://shopify/ProductVariant/51552321110294";
const DISPLAY_5_HD: &str = "gid://shopify/ProductVariant/51552321175830";
const DISPLAY_8_HD: &str = "gid://shopify/ProductVariant/51552322584854";

#[derive(Clone, Copy)]
enum Slot {
    Efi,
    Fuel,
    Ignition,
    Display,
}

struct Component {
    slot: Slot,
    variant_id: &'static str,
    price_cents: i64,
}

struct BundleMetadata<'a> {
    bundle_id: &'a str,
    schema_version: &'a str,
    parent_product_gid: &'a str,
    parent_variant_gid: &'a str,
    parent_sku: &'a str,
    parent_title: &'a str,
}

pub fn build_expand_operation(
    line: &schema::run::input::cart::Lines,
) -> Option<schema::ExpandOperation> {
    let schema::run::input::cart::lines::Merchandise::ProductVariant(variant) = line.merchandise()
    else {
        return None;
    };
    if variant.id() != MASTER_KIT_VARIANT_ID {
        return None;
    }

    let components = selected_components(line);
    let prices = allocate_discounted_prices(&components);
    let metadata = production_bundle_metadata(line, variant);
    let expanded_cart_items = components
        .iter()
        .zip(prices)
        .enumerate()
        .map(|(index, (component, price_cents))| schema::ExpandedItem {
            attributes: metadata
                .as_ref()
                .map(|metadata| component_attributes(metadata, component, index + 1)),
            merchandise_id: component.variant_id.to_string(),
            price: Some(schema::ExpandedItemPriceAdjustment {
                adjustment: schema::ExpandedItemPriceAdjustmentValue::FixedPricePerUnit(
                    schema::ExpandedItemFixedPricePerUnitAdjustment {
                        amount: schema::Decimal::from(price_cents as f64 / 100.0),
                    },
                ),
            }),
            quantity: 1,
        })
        .collect();

    Some(schema::ExpandOperation {
        cart_line_id: line.id().clone(),
        expanded_cart_items,
        image: None,
        price: None,
        title: Some(MASTER_KIT_DISPLAY_TITLE.to_string()),
    })
}

fn selected_components(line: &schema::run::input::cart::Lines) -> Vec<Component> {
    let efi_variant_id = resolve_variant(
        Slot::Efi,
        line.builder_efi_variant_id()
            .and_then(|attribute| attribute.value())
            .map(String::as_str),
    );
    let requested_fuel = resolve_variant(
        Slot::Fuel,
        line.builder_fuel_variant_id()
            .and_then(|attribute| attribute.value())
            .map(String::as_str),
    );
    let fuel_variant_id = if efi_variant_id == EFI_FUSION_LITE && requested_fuel == FUEL_TEST_2 {
        FUEL_TEST
    } else {
        requested_fuel
    };
    let ignition_variant_id = resolve_variant(
        Slot::Ignition,
        line.builder_ignition_variant_id()
            .and_then(|attribute| attribute.value())
            .map(String::as_str),
    );
    let mut components = vec![
        component(Slot::Efi, efi_variant_id),
        component(Slot::Fuel, fuel_variant_id),
        component(Slot::Ignition, ignition_variant_id),
    ];
    if efi_variant_id != EFI_FUSION_LITE {
        let display_variant_id = resolve_variant(
            Slot::Display,
            line.builder_display_variant_id()
                .and_then(|attribute| attribute.value())
                .map(String::as_str),
        );
        components.push(component(Slot::Display, display_variant_id));
    }
    components
}

fn resolve_variant(slot: Slot, requested: Option<&str>) -> &'static str {
    match (slot, requested.map(str::trim)) {
        (Slot::Efi, Some(EFI_KILLSHOT_2_PRO)) => EFI_KILLSHOT_2_PRO,
        (Slot::Efi, _) => EFI_FUSION_LITE,
        (Slot::Fuel, Some(FUEL_TEST_2)) => FUEL_TEST_2,
        (Slot::Fuel, _) => FUEL_TEST,
        (Slot::Ignition, Some(IGNITION_HIGH_ROLLER)) => IGNITION_HIGH_ROLLER,
        (Slot::Ignition, _) => IGNITION_BLACK_JACK,
        (Slot::Display, Some(DISPLAY_8_HD)) => DISPLAY_8_HD,
        (Slot::Display, _) => DISPLAY_5_HD,
    }
}

fn component(slot: Slot, variant_id: &'static str) -> Component {
    let price_cents = match variant_id {
        EFI_FUSION_LITE => 53_999,
        EFI_KILLSHOT_2_PRO => 78_999,
        FUEL_TEST => 20_000,
        FUEL_TEST_2 => 35_000,
        IGNITION_BLACK_JACK => 4_999,
        IGNITION_HIGH_ROLLER => 34_299,
        DISPLAY_5_HD => 34_599,
        DISPLAY_8_HD => 64_999,
        _ => 0,
    };
    Component {
        slot,
        variant_id,
        price_cents,
    }
}

fn allocate_discounted_prices(components: &[Component]) -> Vec<i64> {
    let subtotal_cents: i64 = components
        .iter()
        .map(|component| component.price_cents)
        .sum();
    let final_total_cents = subtotal_cents - percentage_discount_cents(subtotal_cents);
    let mut prices: Vec<_> = components
        .iter()
        .map(|component| component.price_cents - percentage_discount_cents(component.price_cents))
        .collect();
    let allocated_total_cents: i64 = prices.iter().sum();
    if let Some(last) = prices.last_mut() {
        *last += final_total_cents - allocated_total_cents;
    }
    prices
}

fn percentage_discount_cents(price_cents: i64) -> i64 {
    (price_cents * BUNDLE_DISCOUNT_BASIS_POINTS + 5_000) / 10_000
}

fn production_bundle_metadata<'a>(
    line: &'a schema::run::input::cart::Lines,
    variant: &'a schema::run::input::cart::lines::merchandise::ProductVariant,
) -> Option<BundleMetadata<'a>> {
    let bundle_id = line.bundle_id()?.value()?.trim();
    let schema_version = line.bundle_schema_version()?.value()?.trim();
    if !is_uuid(bundle_id)
        || schema_version != BUNDLE_SCHEMA_VERSION
        || !is_gid_with_numeric_id(variant.product().id(), "gid://shopify/Product/")
    {
        return None;
    }
    Some(BundleMetadata {
        bundle_id,
        schema_version,
        parent_product_gid: variant.product().id(),
        parent_variant_gid: variant.id(),
        parent_sku: line
            .parent_sku()
            .and_then(|attribute| attribute.value())
            .map_or("", String::as_str),
        parent_title: line
            .parent_title()
            .and_then(|attribute| attribute.value())
            .map_or("", String::as_str),
    })
}

fn component_attributes(
    metadata: &BundleMetadata<'_>,
    component: &Component,
    sequence: usize,
) -> Vec<schema::AttributeOutput> {
    let (group, role) = match component.slot {
        Slot::Efi => ("efi_system", "efi"),
        Slot::Fuel => ("fuel_system", "fuel_delivery"),
        Slot::Ignition => ("ignition", "ignition"),
        Slot::Display => ("display", "display_controller"),
    };
    vec![
        attribute("_bundle_id", metadata.bundle_id),
        attribute("_bundle_schema_version", metadata.schema_version),
        attribute("_parent_product_gid", metadata.parent_product_gid),
        attribute("_parent_variant_gid", metadata.parent_variant_gid),
        attribute("_parent_sku", metadata.parent_sku),
        attribute("_parent_title", metadata.parent_title),
        attribute("_component_group", group),
        attribute("_component_role", role),
        attribute("_component_variant_gid", component.variant_id),
        attribute("_component_sequence", &sequence.to_string()),
    ]
}

fn attribute(key: &str, value: &str) -> schema::AttributeOutput {
    schema::AttributeOutput {
        key: key.to_string(),
        value: value.to_string(),
    }
}

fn is_uuid(value: &str) -> bool {
    let bytes = value.as_bytes();
    bytes.len() == 36
        && bytes[8] == b'-'
        && bytes[13] == b'-'
        && bytes[18] == b'-'
        && bytes[23] == b'-'
        && matches!(bytes[14], b'1'..=b'5')
        && matches!(bytes[19].to_ascii_lowercase(), b'8' | b'9' | b'a' | b'b')
        && bytes
            .iter()
            .enumerate()
            .all(|(index, byte)| matches!(index, 8 | 13 | 18 | 23) || byte.is_ascii_hexdigit())
}

fn is_gid_with_numeric_id(value: &str, prefix: &str) -> bool {
    value
        .strip_prefix(prefix)
        .is_some_and(|id| !id.is_empty() && id.bytes().all(|byte| byte.is_ascii_digit()))
}
