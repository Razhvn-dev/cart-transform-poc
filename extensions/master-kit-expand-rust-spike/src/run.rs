use super::schema;
use super::shared_core;
use shopify_function::prelude::*;
use shopify_function::Result;
use std::collections::{BTreeMap, HashSet};

pub struct FunctionRunResult {
    pub operations: Vec<schema::CartOperation>,
}

impl shopify_function::wasm_api::Serialize for FunctionRunResult {
    fn serialize(
        &self,
        context: &mut shopify_function::wasm_api::Context,
    ) -> std::result::Result<(), shopify_function::wasm_api::write::Error> {
        context.write_object(
            |context| {
                context.write_utf8_str("operations")?;
                context.write_array(
                    |context| {
                        for operation in &self.operations {
                            serialize_operation(operation, context)?;
                        }
                        Ok(())
                    },
                    self.operations.len(),
                )
            },
            1,
        )
    }
}

fn serialize_operation(
    operation: &schema::CartOperation,
    context: &mut shopify_function::wasm_api::Context,
) -> std::result::Result<(), shopify_function::wasm_api::write::Error> {
    match operation {
        schema::CartOperation::Expand(expand) => context.write_object(
            |context| {
                context.write_utf8_str("expand")?;
                serialize_expand(expand, context)
            },
            1,
        ),
        schema::CartOperation::Merge(_) | schema::CartOperation::Update(_) => {
            shopify_function::wasm_api::Serialize::serialize(operation, context)
        }
    }
}

fn serialize_expand(
    expand: &schema::ExpandOperation,
    context: &mut shopify_function::wasm_api::Context,
) -> std::result::Result<(), shopify_function::wasm_api::write::Error> {
    let field_count = 2
        + usize::from(expand.image.is_some())
        + usize::from(expand.price.is_some())
        + usize::from(expand.title.is_some());
    context.write_object(
        |context| {
            context.write_utf8_str("cartLineId")?;
            context.write_utf8_str(&expand.cart_line_id)?;
            context.write_utf8_str("expandedCartItems")?;
            context.write_array(
                |context| {
                    for item in &expand.expanded_cart_items {
                        serialize_expanded_item(item, context)?;
                    }
                    Ok(())
                },
                expand.expanded_cart_items.len(),
            )?;
            if let Some(image) = &expand.image {
                context.write_utf8_str("image")?;
                shopify_function::wasm_api::Serialize::serialize(image, context)?;
            }
            if let Some(price) = &expand.price {
                context.write_utf8_str("price")?;
                shopify_function::wasm_api::Serialize::serialize(price, context)?;
            }
            if let Some(title) = &expand.title {
                context.write_utf8_str("title")?;
                context.write_utf8_str(title)?;
            }
            Ok(())
        },
        field_count,
    )
}

fn serialize_expanded_item(
    item: &schema::ExpandedItem,
    context: &mut shopify_function::wasm_api::Context,
) -> std::result::Result<(), shopify_function::wasm_api::write::Error> {
    let field_count =
        2 + usize::from(item.attributes.is_some()) + usize::from(item.price.is_some());
    context.write_object(
        |context| {
            if let Some(attributes) = &item.attributes {
                context.write_utf8_str("attributes")?;
                shopify_function::wasm_api::Serialize::serialize(attributes, context)?;
            }
            context.write_utf8_str("merchandiseId")?;
            context.write_utf8_str(&item.merchandise_id)?;
            if let Some(price) = &item.price {
                context.write_utf8_str("price")?;
                serialize_expanded_item_price(price, context)?;
            }
            context.write_utf8_str("quantity")?;
            shopify_function::wasm_api::Serialize::serialize(&item.quantity, context)
        },
        field_count,
    )
}

fn serialize_expanded_item_price(
    price: &schema::ExpandedItemPriceAdjustment,
    context: &mut shopify_function::wasm_api::Context,
) -> std::result::Result<(), shopify_function::wasm_api::write::Error> {
    let schema::ExpandedItemPriceAdjustmentValue::FixedPricePerUnit(fixed) = &price.adjustment;
    context.write_object(
        |context| {
            context.write_utf8_str("adjustment")?;
            context.write_object(
                |context| {
                    context.write_utf8_str("fixedPricePerUnit")?;
                    context.write_object(
                        |context| {
                            context.write_utf8_str("amount")?;
                            context.write_utf8_str(&format!("{:.2}", fixed.amount.as_f64()))
                        },
                        1,
                    )
                },
                1,
            )
        },
        1,
    )
}

#[derive(PartialEq, Debug)]
pub struct Projection {
    pub schema_version: String,
    pub contract_identity: Option<String>,
    pub checksum_algorithm: String,
    pub bundle_definition_id: String,
    pub published_revision_id: String,
    pub source_snapshot_checksum: String,
    pub parent: ProjectionParent,
    pub components: Vec<ProjectionComponent>,
    pub checksum: String,
}

#[derive(PartialEq, Debug)]
pub struct ProjectionParent {
    pub product_gid: String,
    pub variant_gid: String,
    pub sku: String,
    pub title: String,
    pub fixed_price_per_unit: Option<String>,
}

#[derive(PartialEq, Debug)]
pub struct ProjectionComponent {
    pub sequence: i64,
    pub group: String,
    pub role: String,
    pub product_gid: String,
    pub variant_gid: String,
    pub sku: String,
    pub title: String,
    pub fixed_price_per_unit: String,
    pub quantity: i64,
    pub source_identity: Option<String>,
    pub audit_provenance: Option<ProjectionAuditProvenance>,
}

#[derive(PartialEq, Debug)]
pub struct ProjectionAuditProvenance {
    pub source_system: String,
    pub source_bundle_id: String,
    pub source_record_checksum: String,
}

struct BundleMetadata<'a> {
    bundle_instance_id: &'a str,
    schema_version: &'a str,
}

#[shopify_function]
pub fn run(input: schema::run::Input) -> Result<FunctionRunResult> {
    let lines = input.cart().lines();
    let mut duplicate_cart_line_ids = HashSet::new();
    if lines.len() > 1 {
        let mut seen_cart_line_ids = HashSet::with_capacity(lines.len());
        for line in lines {
            if !seen_cart_line_ids.insert(line.id().as_str()) {
                duplicate_cart_line_ids.insert(line.id().as_str());
            }
        }
    }

    let mut candidate_operations = Vec::new();
    let mut candidate_cart_line_ids = HashSet::new();
    let mut seen_bundle_ids = (lines.len() > 1).then(|| HashSet::with_capacity(lines.len()));
    let mut candidate_invalid = false;

    for line in lines {
        let Some(projection_json) = projection_json_for_line(line) else {
            continue;
        };
        let Some(metadata) = valid_metadata(line) else {
            candidate_invalid = true;
            continue;
        };
        let Some(projection) = parse_projection(projection_json)
            .filter(|projection| valid_projection(line, projection))
        else {
            candidate_invalid = true;
            continue;
        };
        if seen_bundle_ids
            .as_mut()
            .is_some_and(|seen| !seen.insert(metadata.bundle_instance_id))
        {
            candidate_invalid = true;
            continue;
        }
        if duplicate_cart_line_ids.contains(line.id().as_str())
            || !candidate_cart_line_ids.insert(line.id().as_str())
        {
            candidate_invalid = true;
            continue;
        }
        candidate_operations.push(schema::CartOperation::Expand(build_expand(
            line,
            &metadata,
            &projection,
        )));
    }

    // Safety contract: any ambiguous pre-built candidate batch fails closed as a whole.
    // Shared Core remains authoritative for every eligible line, including cross-path ID conflicts.
    if candidate_invalid {
        candidate_operations.clear();
        candidate_cart_line_ids.clear();
    }

    let mut operations: Vec<_> = lines
        .iter()
        .filter(|line| !candidate_cart_line_ids.contains(line.id().as_str()))
        .filter_map(shared_core::build_expand_operation)
        .map(schema::CartOperation::Expand)
        .collect();
    operations.extend(candidate_operations);

    Ok(FunctionRunResult { operations })
}

fn valid_metadata(line: &schema::run::input::cart::Lines) -> Option<BundleMetadata<'_>> {
    if line.id().is_empty() || *line.quantity() != 1 {
        return None;
    }
    let schema::run::input::cart::lines::Merchandise::ProductVariant(variant) = line.merchandise()
    else {
        return None;
    };
    let parent_product_gid = line.parent_product_gid()?.value()?;
    if parent_product_gid != variant.product().id() {
        return None;
    }
    let parent_variant_gid = line.parent_variant_gid()?.value()?;
    if parent_variant_gid != variant.id() {
        return None;
    }
    line.parent_sku()?.value()?;
    line.parent_title()?.value()?;
    let schema_version = line.bundle_schema_version()?.value()?;
    if schema_version != "1" {
        return None;
    }
    let bundle_instance_id = line.bundle_id()?.value()?;
    if !is_uuid(bundle_instance_id) {
        return None;
    }
    Some(BundleMetadata {
        bundle_instance_id,
        schema_version,
    })
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

fn valid_projection(line: &schema::run::input::cart::Lines, projection: &Projection) -> bool {
    let schema::run::input::cart::lines::Merchandise::ProductVariant(variant) = line.merchandise()
    else {
        return false;
    };
    let is_v2_schema = projection.schema_version == "prebuilt_bundle_expand_projection.v2";
    let parse_projection_price = if is_v2_schema {
        decimal_cents_v2
    } else {
        decimal_cents
    };
    let parent_price_cents = if is_v2_schema {
        decimal_cents_safe(line.cost().amount_per_quantity().amount())
    } else {
        decimal_cents(line.cost().amount_per_quantity().amount())
    };
    let Some(parent_price_cents) = parent_price_cents else {
        return false;
    };
    let Some(component_price_cents) =
        projection
            .components
            .iter()
            .try_fold(0_i64, |total, component| {
                let unit_price = parse_projection_price(&component.fixed_price_per_unit)?;
                let quantity_price = unit_price.checked_mul(component.quantity)?;
                let next_total = total.checked_add(quantity_price)?;
                if is_v2_schema
                    && (quantity_price > 9_007_199_254_740_991
                        || next_total > 9_007_199_254_740_991)
                {
                    None
                } else {
                    Some(next_total)
                }
            })
    else {
        return false;
    };
    let is_v1 = projection.schema_version == "prebuilt_bundle_expand_projection.v1"
        && projection.contract_identity.is_none()
        && projection.parent.fixed_price_per_unit.is_none()
        && projection.components.iter().all(|component| {
            component.quantity == 1
                && component.source_identity.is_none()
                && component.audit_provenance.is_none()
        });
    let is_v2 = projection.schema_version == "prebuilt_bundle_expand_projection.v2"
        && projection.contract_identity.as_deref() == Some("prebuilt_bundle_expand_projection.v2")
        && projection
            .parent
            .fixed_price_per_unit
            .as_deref()
            .and_then(decimal_cents_v2)
            == Some(parent_price_cents)
        && projection.components.iter().all(|component| {
            (1..=i64::from(i32::MAX)).contains(&component.quantity)
                && is_gid_with_numeric_id(&component.product_gid, "gid://shopify/Product/")
                && !component.sku.trim().is_empty()
                && !component.title.trim().is_empty()
                && component
                    .source_identity
                    .as_deref()
                    .is_some_and(|value| !value.trim().is_empty())
                && component.audit_provenance.as_ref().is_some_and(|value| {
                    !value.source_system.trim().is_empty()
                        && !value.source_bundle_id.trim().is_empty()
                        && !value.source_record_checksum.trim().is_empty()
                })
        });
    (is_v1 || is_v2)
        && projection.checksum_algorithm == "fnv1a-32"
        && is_uuid(&projection.bundle_definition_id)
        && is_uuid(&projection.published_revision_id)
        && !projection.source_snapshot_checksum.trim().is_empty()
        && projection.parent.product_gid == *variant.product().id()
        && projection.parent.variant_gid == *variant.id()
        && !projection.parent.title.trim().is_empty()
        && !projection.components.is_empty()
        && projection
            .components
            .iter()
            .enumerate()
            .all(|(index, component)| {
                component.sequence == (index + 1) as i64 && valid_component_shape(component)
            })
        && unique_component_variants(&projection.components)
        && component_price_cents == parent_price_cents
        && projection_checksum_matches(projection)
}

fn projection_checksum_matches(projection: &Projection) -> bool {
    let mut canonical = String::new();
    canonical.push_str("{\"bundle_definition_id\":");
    push_json_string(&mut canonical, &projection.bundle_definition_id);
    canonical.push_str(",\"checksum_algorithm\":");
    push_json_string(&mut canonical, &projection.checksum_algorithm);
    canonical.push_str(",\"components\":[");
    for (index, component) in projection.components.iter().enumerate() {
        if index > 0 {
            canonical.push(',');
        }
        canonical.push('{');
        if projection.schema_version == "prebuilt_bundle_expand_projection.v2" {
            let provenance = component.audit_provenance.as_ref();
            canonical.push_str("\"audit_provenance\":{\"source_bundle_id\":");
            push_json_string(
                &mut canonical,
                provenance.map_or("", |value| value.source_bundle_id.as_str()),
            );
            canonical.push_str(",\"source_record_checksum\":");
            push_json_string(
                &mut canonical,
                provenance.map_or("", |value| value.source_record_checksum.as_str()),
            );
            canonical.push_str(",\"source_system\":");
            push_json_string(
                &mut canonical,
                provenance.map_or("", |value| value.source_system.as_str()),
            );
            canonical.push_str("},\"fixed_price_per_unit\":");
        } else {
            canonical.push_str("\"fixed_price_per_unit\":");
        }
        push_json_string(&mut canonical, &component.fixed_price_per_unit);
        canonical.push_str(",\"group\":");
        push_json_string(&mut canonical, &component.group);
        canonical.push_str(",\"product_gid\":");
        push_json_string(&mut canonical, &component.product_gid);
        if projection.schema_version == "prebuilt_bundle_expand_projection.v2" {
            canonical.push_str(",\"quantity\":");
            canonical.push_str(&component.quantity.to_string());
        }
        canonical.push_str(",\"role\":");
        push_json_string(&mut canonical, &component.role);
        canonical.push_str(",\"sequence\":");
        canonical.push_str(&component.sequence.to_string());
        canonical.push_str(",\"sku\":");
        push_json_string(&mut canonical, &component.sku);
        if projection.schema_version == "prebuilt_bundle_expand_projection.v2" {
            canonical.push_str(",\"source_identity\":");
            push_json_string(
                &mut canonical,
                component.source_identity.as_deref().unwrap_or_default(),
            );
        }
        canonical.push_str(",\"title\":");
        push_json_string(&mut canonical, &component.title);
        canonical.push_str(",\"variant_gid\":");
        push_json_string(&mut canonical, &component.variant_gid);
        canonical.push('}');
    }
    canonical.push(']');
    if projection.schema_version == "prebuilt_bundle_expand_projection.v2" {
        canonical.push_str(",\"contract_identity\":");
        push_json_string(
            &mut canonical,
            projection.contract_identity.as_deref().unwrap_or_default(),
        );
    }
    canonical.push_str(",\"parent\":{");
    if projection.schema_version == "prebuilt_bundle_expand_projection.v2" {
        canonical.push_str("\"fixed_price_per_unit\":");
        push_json_string(
            &mut canonical,
            projection
                .parent
                .fixed_price_per_unit
                .as_deref()
                .unwrap_or_default(),
        );
        canonical.push_str(",\"product_gid\":");
    } else {
        canonical.push_str("\"product_gid\":");
    }
    push_json_string(&mut canonical, &projection.parent.product_gid);
    canonical.push_str(",\"sku\":");
    push_json_string(&mut canonical, &projection.parent.sku);
    canonical.push_str(",\"title\":");
    push_json_string(&mut canonical, &projection.parent.title);
    canonical.push_str(",\"variant_gid\":");
    push_json_string(&mut canonical, &projection.parent.variant_gid);
    canonical.push_str("},\"published_revision_id\":");
    push_json_string(&mut canonical, &projection.published_revision_id);
    canonical.push_str(",\"schema_version\":");
    push_json_string(&mut canonical, &projection.schema_version);
    canonical.push_str(",\"source_snapshot_checksum\":");
    push_json_string(&mut canonical, &projection.source_snapshot_checksum);
    canonical.push('}');

    fnv1a32(&canonical) == projection.checksum
}

fn push_json_string(output: &mut String, value: &str) {
    output.push('"');
    for character in value.chars() {
        match character {
            '"' => output.push_str("\\\""),
            '\\' => output.push_str("\\\\"),
            '\u{0008}' => output.push_str("\\b"),
            '\u{000c}' => output.push_str("\\f"),
            '\n' => output.push_str("\\n"),
            '\r' => output.push_str("\\r"),
            '\t' => output.push_str("\\t"),
            '\u{0000}'..='\u{001f}' => {
                output.push_str("\\u00");
                let value = character as u8;
                output.push(hex_digit(value >> 4));
                output.push(hex_digit(value & 0x0f));
            }
            _ => output.push(character),
        }
    }
    output.push('"');
}

fn hex_digit(value: u8) -> char {
    match value {
        0..=9 => (b'0' + value) as char,
        _ => (b'a' + value - 10) as char,
    }
}

fn fnv1a32(value: &str) -> String {
    let hash = value
        .encode_utf16()
        .fold(0x811c9dc5_u32, |hash, code_unit| {
            (hash ^ u32::from(code_unit)).wrapping_mul(0x01000193)
        });
    format!("{hash:08x}")
}

fn valid_component_shape(component: &ProjectionComponent) -> bool {
    !component.group.trim().is_empty()
        && !component.role.trim().is_empty()
        && is_gid_with_numeric_id(&component.variant_gid, "gid://shopify/ProductVariant/")
}

fn is_gid_with_numeric_id(value: &str, prefix: &str) -> bool {
    value
        .strip_prefix(prefix)
        .is_some_and(|id| !id.is_empty() && id.bytes().all(|byte| byte.is_ascii_digit()))
}

fn projection_json_for_line(line: &schema::run::input::cart::Lines) -> Option<&JsonValue> {
    let schema::run::input::cart::lines::Merchandise::ProductVariant(variant) = line.merchandise()
    else {
        return None;
    };
    Some(
        variant
            .product()
            .prebuilt_expand_projection_metafield()?
            .json_value(),
    )
}

fn parse_projection(value: &JsonValue) -> Option<Projection> {
    let object = json_object(value)?;
    let schema_version = json_string(object, "schema_version")?.to_string();
    let is_v2 = schema_version == "prebuilt_bundle_expand_projection.v2";
    Some(Projection {
        schema_version,
        contract_identity: if is_v2 {
            Some(json_string(object, "contract_identity")?.to_string())
        } else {
            None
        },
        checksum_algorithm: json_string(object, "checksum_algorithm")?.to_string(),
        bundle_definition_id: json_string(object, "bundle_definition_id")?.to_string(),
        published_revision_id: json_string(object, "published_revision_id")?.to_string(),
        source_snapshot_checksum: json_string(object, "source_snapshot_checksum")?.to_string(),
        parent: parse_projection_parent(object.get("parent")?, is_v2)?,
        components: json_array(object, "components")?
            .iter()
            .map(|component| parse_projection_component(component, is_v2))
            .collect::<Option<Vec<_>>>()?,
        checksum: json_string(object, "checksum")?.to_string(),
    })
}

fn parse_projection_parent(value: &JsonValue, is_v2: bool) -> Option<ProjectionParent> {
    let object = json_object(value)?;
    Some(ProjectionParent {
        product_gid: json_string(object, "product_gid")?.to_string(),
        variant_gid: json_string(object, "variant_gid")?.to_string(),
        sku: json_string(object, "sku")?.to_string(),
        title: json_string(object, "title")?.to_string(),
        fixed_price_per_unit: if is_v2 {
            Some(json_string(object, "fixed_price_per_unit")?.to_string())
        } else {
            None
        },
    })
}

fn parse_projection_component(value: &JsonValue, is_v2: bool) -> Option<ProjectionComponent> {
    let object = json_object(value)?;
    Some(ProjectionComponent {
        sequence: json_i64(object, "sequence")?,
        group: json_string(object, "group")?.to_string(),
        role: json_string(object, "role")?.to_string(),
        product_gid: json_string(object, "product_gid")?.to_string(),
        variant_gid: json_string(object, "variant_gid")?.to_string(),
        sku: json_string(object, "sku")?.to_string(),
        title: json_string(object, "title")?.to_string(),
        fixed_price_per_unit: json_string(object, "fixed_price_per_unit")?.to_string(),
        quantity: if is_v2 {
            json_i64(object, "quantity")?
        } else {
            1
        },
        source_identity: if is_v2 {
            Some(json_string(object, "source_identity")?.to_string())
        } else {
            None
        },
        audit_provenance: if is_v2 {
            Some(parse_projection_audit_provenance(
                object.get("audit_provenance")?,
            )?)
        } else {
            None
        },
    })
}

fn parse_projection_audit_provenance(value: &JsonValue) -> Option<ProjectionAuditProvenance> {
    let object = json_object(value)?;
    if object.len() != 3 {
        return None;
    }
    Some(ProjectionAuditProvenance {
        source_system: json_string(object, "source_system")?.to_string(),
        source_bundle_id: json_string(object, "source_bundle_id")?.to_string(),
        source_record_checksum: json_string(object, "source_record_checksum")?.to_string(),
    })
}

fn json_object(value: &JsonValue) -> Option<&BTreeMap<String, JsonValue>> {
    let JsonValue::Object(object) = value else {
        return None;
    };
    Some(object)
}

fn json_string<'a>(object: &'a BTreeMap<String, JsonValue>, key: &str) -> Option<&'a str> {
    let JsonValue::String(value) = object.get(key)? else {
        return None;
    };
    Some(value)
}

fn json_array<'a>(object: &'a BTreeMap<String, JsonValue>, key: &str) -> Option<&'a [JsonValue]> {
    let JsonValue::Array(value) = object.get(key)? else {
        return None;
    };
    Some(value)
}

fn json_i64(object: &BTreeMap<String, JsonValue>, key: &str) -> Option<i64> {
    let JsonValue::Number(value) = object.get(key)? else {
        return None;
    };
    if !value.is_finite()
        || value.fract() != 0.0
        || *value < i64::MIN as f64
        || *value > i64::MAX as f64
    {
        return None;
    }
    Some(*value as i64)
}

fn unique_component_variants(components: &[ProjectionComponent]) -> bool {
    if components.len() < 2 {
        return true;
    }
    let mut seen = HashSet::with_capacity(components.len());
    components
        .iter()
        .all(|component| seen.insert(component.variant_gid.as_str()))
}

fn decimal_cents(value: &str) -> Option<i64> {
    let (whole, fraction) = value.split_once('.')?;
    if whole.is_empty()
        || fraction.len() != 2
        || !whole.bytes().all(|byte| byte.is_ascii_digit())
        || !fraction.bytes().all(|byte| byte.is_ascii_digit())
    {
        return None;
    }
    whole
        .parse::<i64>()
        .ok()?
        .checked_mul(100)?
        .checked_add(fraction.parse::<i64>().ok()?)
}

fn decimal_cents_v2(value: &str) -> Option<i64> {
    let (whole, _) = value.split_once('.')?;
    if whole.len() > 1 && whole.starts_with('0') {
        return None;
    }
    decimal_cents(value).filter(|minor_units| *minor_units <= 9_007_199_254_740_991)
}

fn decimal_cents_safe(value: &str) -> Option<i64> {
    decimal_cents(value).filter(|minor_units| *minor_units <= 9_007_199_254_740_991)
}

fn build_expand(
    line: &schema::run::input::cart::Lines,
    metadata: &BundleMetadata<'_>,
    projection: &Projection,
) -> schema::ExpandOperation {
    let expanded_cart_items = projection
        .components
        .iter()
        .map(|component| schema::ExpandedItem {
            attributes: Some(vec![
                attribute("_bundle_id", metadata.bundle_instance_id),
                attribute("_bundle_schema_version", metadata.schema_version),
                attribute("_parent_product_gid", &projection.parent.product_gid),
                attribute("_parent_variant_gid", &projection.parent.variant_gid),
                attribute("_parent_sku", &projection.parent.sku),
                attribute("_parent_title", &projection.parent.title),
                attribute("_component_group", &component.group),
                attribute("_component_role", &component.role),
                attribute("_component_variant_gid", &component.variant_gid),
                attribute("_component_sequence", &component.sequence.to_string()),
            ]),
            merchandise_id: component.variant_gid.clone(),
            price: Some(schema::ExpandedItemPriceAdjustment {
                adjustment: schema::ExpandedItemPriceAdjustmentValue::FixedPricePerUnit(
                    schema::ExpandedItemFixedPricePerUnitAdjustment {
                        amount: schema::Decimal::from(
                            component.fixed_price_per_unit.parse::<f64>().unwrap(),
                        ),
                    },
                ),
            }),
            quantity: i32::try_from(component.quantity).expect("validated component quantity"),
        })
        .collect();

    schema::ExpandOperation {
        cart_line_id: line.id().clone(),
        expanded_cart_items,
        image: None,
        price: None,
        title: Some(projection.parent.title.clone()),
    }
}

fn attribute(key: &str, value: &str) -> schema::AttributeOutput {
    schema::AttributeOutput {
        key: key.to_string(),
        value: value.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use shopify_function::{run_function_with_input, Result};

    const MASTER_KIT_VARIANT_ID: &str = "gid://shopify/ProductVariant/51505325605142";
    const EFI_FUSION_LITE: &str = "gid://shopify/ProductVariant/51592538587414";
    const EFI_KILLSHOT_2_PRO: &str = "gid://shopify/ProductVariant/51552319865110";
    const FUEL_TEST: &str = "gid://shopify/ProductVariant/51505348346134";
    const FUEL_TEST_2: &str = "gid://shopify/ProductVariant/51518319591702";
    const IGNITION_BLACK_JACK: &str = "gid://shopify/ProductVariant/51592730706198";
    const IGNITION_HIGH_ROLLER: &str = "gid://shopify/ProductVariant/51552321110294";
    const DISPLAY_8_HD: &str = "gid://shopify/ProductVariant/51552322584854";
    const DELETED_EFI_FUSION_LITE: &str = "gid://shopify/ProductVariant/51552319766806";
    const DELETED_IGNITION_BLACK_JACK: &str = "gid://shopify/ProductVariant/51552321011990";

    #[test]
    fn valid_eight_components_expand() -> Result<()> {
        let input = include_str!("../tests/fixtures/valid-8.json");
        let result = run_function_with_input(run, input)?;

        assert_eq!(result.operations.len(), 1);
        let schema::CartOperation::Expand(expand) = &result.operations[0] else {
            panic!("expected expand operation");
        };
        assert_eq!(
            expand.cart_line_id,
            "gid://shopify/CartLine/prebuilt-projection-budget"
        );
        assert_eq!(expand.title.as_deref(), Some("AS2014B2-MK-2011-4005P"));
        assert_eq!(expand.expanded_cart_items.len(), 8);

        for (index, item) in expand.expanded_cart_items.iter().enumerate() {
            let sequence = index + 1;
            assert_eq!(item.quantity, 1);
            assert_eq!(
                item.merchandise_id,
                format!(
                    "gid://shopify/ProductVariant/{}",
                    20_000_000_000_001_i64 + index as i64
                ),
            );
            let attributes = item.attributes.as_ref().expect("component attributes");
            assert_eq!(attributes.len(), 10);
            assert_eq!(
                attribute_pair(&attributes[0]),
                ("_bundle_id", "11111111-1111-4111-8111-111111111111")
            );
            assert_eq!(
                attribute_pair(&attributes[1]),
                ("_bundle_schema_version", "1")
            );
            assert_eq!(
                attribute_pair(&attributes[2]),
                (
                    "_parent_product_gid",
                    "gid://shopify/Product/10638456357142"
                )
            );
            assert_eq!(
                attribute_pair(&attributes[3]),
                (
                    "_parent_variant_gid",
                    "gid://shopify/ProductVariant/51592577089814"
                )
            );
            assert_eq!(
                attribute_pair(&attributes[4]),
                ("_parent_sku", "AS2014B2-MK-2011-4005P")
            );
            assert_eq!(
                attribute_pair(&attributes[5]),
                ("_parent_title", "AS2014B2-MK-2011-4005P")
            );
            assert_eq!(
                attribute_pair(&attributes[6]),
                ("_component_group", format!("group_{sequence}").as_str())
            );
            assert_eq!(
                attribute_pair(&attributes[7]),
                ("_component_role", format!("role_{sequence}").as_str())
            );
            assert_eq!(
                attribute_pair(&attributes[8]),
                ("_component_variant_gid", item.merchandise_id.as_str())
            );
            assert_eq!(
                attribute_pair(&attributes[9]),
                ("_component_sequence", sequence.to_string().as_str())
            );
            let price = item.price.as_ref().expect("fixed price");
            let schema::ExpandedItemPriceAdjustmentValue::FixedPricePerUnit(fixed) =
                &price.adjustment;
            assert_eq!(fixed.amount.as_f64(), 10.0);
        }

        Ok(())
    }

    #[test]
    fn valid_quantity_v2_expands_physical_quantities() -> Result<()> {
        let result = run_function_with_input(
            run,
            include_str!("../tests/fixtures/valid-quantity-v2.json"),
        )?;

        assert_eq!(result.operations.len(), 1);
        let schema::CartOperation::Expand(expand) = &result.operations[0] else {
            panic!("expected expand operation");
        };
        assert_eq!(
            expand.cart_line_id,
            "gid://shopify/CartLine/prebuilt-quantity-v2"
        );
        assert_eq!(expand.expanded_cart_items.len(), 3);
        assert_eq!(
            expand
                .expanded_cart_items
                .iter()
                .map(|item| item.quantity)
                .collect::<Vec<_>>(),
            vec![2, 4, 8]
        );
        assert_eq!(expanded_prices(expand), vec![1.25, 2.0, 0.5]);
        Ok(())
    }

    #[test]
    fn quantity_v2_price_mismatch_fails_closed() -> Result<()> {
        let input = include_str!("../tests/fixtures/valid-quantity-v2.json")
            .replace("\"amount\": \"14.50\"", "\"amount\": \"14.51\"");

        assert_no_operations(&input)
    }

    #[test]
    fn quantity_v2_non_positive_quantity_fails_closed_with_matching_checksum() -> Result<()> {
        let input = include_str!("../tests/fixtures/valid-quantity-v2.json")
            .replacen("\"quantity\": 2", "\"quantity\": 0", 1)
            .replace("\"checksum\": \"fc699c6c\"", "\"checksum\": \"39b02e36\"");

        assert_no_operations(&input)
    }

    #[test]
    fn quantity_v2_output_overflow_fails_closed_with_matching_checksum() -> Result<()> {
        let input = include_str!("../tests/fixtures/valid-quantity-v2.json")
            .replacen("\"quantity\": 2", "\"quantity\": 2147483648", 1)
            .replace("\"checksum\": \"fc699c6c\"", "\"checksum\": \"6110f0bb\"");

        assert_no_operations(&input)
    }

    #[test]
    fn accepted_projection_fixtures_keep_valid_canonical_checksums() -> Result<()> {
        for input in [
            include_str!("../tests/fixtures/valid-8.json"),
            include_str!("../tests/fixtures/valid-real-10.json"),
            include_str!("../tests/fixtures/valid-12.json"),
        ] {
            let result = run_function_with_input(run, input)?;
            assert_eq!(result.operations.len(), 1);
        }
        Ok(())
    }

    #[test]
    fn missing_projection_fails_closed() -> Result<()> {
        let input = valid_eight_input().replace(
            "\"prebuiltExpandProjectionMetafield\"",
            "\"missingPrebuiltExpandProjectionMetafield\"",
        );

        assert_no_operations(&input)
    }

    #[test]
    fn wrong_projection_schema_version_fails_closed() -> Result<()> {
        let input = valid_eight_input().replace(
            "prebuilt_bundle_expand_projection.v1",
            "prebuilt_bundle_expand_projection.v0",
        );

        assert_no_operations(&input)
    }

    #[test]
    fn changed_projection_checksum_fails_closed() -> Result<()> {
        let input =
            valid_eight_input().replace("\"checksum\": \"eeb56acf\"", "\"checksum\": \"00000000\"");

        assert_no_operations(&input)
    }

    #[test]
    fn invalid_publication_header_fails_closed_with_matching_checksum() -> Result<()> {
        let cases = [
            (
                "\"checksum_algorithm\": \"fnv1a-32\"",
                "\"checksum_algorithm\": \"sha256\"",
                "14841492",
            ),
            (
                "\"bundle_definition_id\": \"7bd39574-70f2-5d52-b8af-4c1717d6f390\"",
                "\"bundle_definition_id\": \"not-a-uuid\"",
                "7dc5a3ee",
            ),
            (
                "\"published_revision_id\": \"f8344a2c-1bfc-5bf6-942f-50bcf9a3be94\"",
                "\"published_revision_id\": \"not-a-uuid\"",
                "7ea3e05c",
            ),
            (
                "\"source_snapshot_checksum\": \"92644e9b\"",
                "\"source_snapshot_checksum\": \"\"",
                "35a1da16",
            ),
        ];

        for (from, to, matching_checksum) in cases {
            let input = valid_eight_input().replace(from, to).replace(
                "\"checksum\": \"eeb56acf\"",
                &format!("\"checksum\": \"{matching_checksum}\""),
            );
            assert_no_operations(&input)?;
        }
        Ok(())
    }

    #[test]
    fn checksum_protected_component_fields_fail_closed_when_tampered() -> Result<()> {
        let cases = [
            (
                "\"product_gid\": \"gid://shopify/Product/10000000000001\"",
                "\"product_gid\": \"gid://shopify/Product/99999999999999\"",
            ),
            ("\"sku\": \"SKU-01\"", "\"sku\": \"\""),
            ("\"title\": \"Component 1\"", "\"title\": \"\""),
        ];

        for (from, to) in cases {
            assert_no_operations(&valid_eight_input().replacen(from, to, 1))?;
        }
        Ok(())
    }

    #[test]
    fn shared_core_standard_build_matches_hard_coded_authority() -> Result<()> {
        let result = run_fixture(&standard_builder_input())?;
        let expand = only_expand(&result);

        assert_eq!(expand.title.as_deref(), Some("Master Kit Test"));
        assert_eq!(
            expanded_variant_ids(expand),
            vec![EFI_FUSION_LITE, FUEL_TEST, IGNITION_BLACK_JACK,]
        );
        assert_eq!(expanded_prices(expand), vec![512.99, 190.0, 47.49]);
        assert_eq!(
            attribute_value(&expand.expanded_cart_items[0], "_component_group"),
            Some("efi_system")
        );
        assert_eq!(
            attribute_value(&expand.expanded_cart_items[0], "_component_role"),
            Some("efi")
        );
        Ok(())
    }

    #[test]
    fn shared_core_advanced_build_matches_hard_coded_authority() -> Result<()> {
        let result = run_fixture(&advanced_builder_input())?;
        let expand = only_expand(&result);

        assert_eq!(
            expanded_variant_ids(expand),
            vec![
                EFI_KILLSHOT_2_PRO,
                FUEL_TEST_2,
                IGNITION_HIGH_ROLLER,
                DISPLAY_8_HD,
            ]
        );
        assert_eq!(expanded_prices(expand), vec![750.49, 332.5, 325.84, 617.49]);
        Ok(())
    }

    #[test]
    fn shared_core_falls_back_for_untrusted_component_selections() -> Result<()> {
        let input = builder_input(
            "gid://shopify/ProductVariant/1",
            "gid://shopify/ProductVariant/2",
            "gid://shopify/ProductVariant/3",
            Some("gid://shopify/ProductVariant/4"),
        );
        let result = run_fixture(&input)?;

        assert_eq!(
            expanded_variant_ids(only_expand(&result)),
            vec![EFI_FUSION_LITE, FUEL_TEST, IGNITION_BLACK_JACK,]
        );
        Ok(())
    }

    #[test]
    fn shared_core_enforces_fusion_lite_fuel_compatibility_and_hides_display() -> Result<()> {
        let input = builder_input(
            EFI_FUSION_LITE,
            FUEL_TEST_2,
            IGNITION_BLACK_JACK,
            Some(DISPLAY_8_HD),
        );
        let result = run_fixture(&input)?;

        assert_eq!(
            expanded_variant_ids(only_expand(&result)),
            vec![EFI_FUSION_LITE, FUEL_TEST, IGNITION_BLACK_JACK,]
        );
        Ok(())
    }

    #[test]
    fn shared_core_builder_paths_never_return_deleted_standard_variants() -> Result<()> {
        let cases = [
            standard_builder_input(),
            builder_input(
                "gid://shopify/ProductVariant/1",
                "gid://shopify/ProductVariant/2",
                "gid://shopify/ProductVariant/3",
                None,
            ),
            builder_input(
                EFI_FUSION_LITE,
                FUEL_TEST_2,
                IGNITION_BLACK_JACK,
                Some(DISPLAY_8_HD),
            ),
            advanced_builder_input(),
        ];

        for input in cases {
            let result = run_fixture(&input)?;
            let variants = expanded_variant_ids(only_expand(&result));
            assert!(!variants.contains(&DELETED_EFI_FUSION_LITE));
            assert!(!variants.contains(&DELETED_IGNITION_BLACK_JACK));
        }
        Ok(())
    }

    #[test]
    fn shared_core_falls_back_to_current_standard_for_deleted_builder_variants() -> Result<()> {
        let input = builder_input(
            DELETED_EFI_FUSION_LITE,
            FUEL_TEST,
            DELETED_IGNITION_BLACK_JACK,
            None,
        );
        let result = run_fixture(&input)?;
        let variants = expanded_variant_ids(only_expand(&result));

        assert_eq!(
            variants,
            vec![EFI_FUSION_LITE, FUEL_TEST, IGNITION_BLACK_JACK,]
        );
        assert!(!variants.contains(&DELETED_EFI_FUSION_LITE));
        assert!(!variants.contains(&DELETED_IGNITION_BLACK_JACK));
        Ok(())
    }

    #[test]
    fn shared_core_legacy_metadata_still_expands_without_component_attributes() -> Result<()> {
        let input = standard_builder_input().replacen("\"bundleId\":", "\"missingBundleId\":", 1);
        let result = run_fixture(&input)?;
        let expand = only_expand(&result);

        assert_eq!(expand.expanded_cart_items.len(), 3);
        assert!(expand
            .expanded_cart_items
            .iter()
            .all(|item| item.attributes.is_none()));
        Ok(())
    }

    #[test]
    fn hybrid_places_shared_core_before_valid_prebuilt_operations() -> Result<()> {
        let builder_line = only_cart_line(&standard_builder_input().replace(
            "gid://shopify/CartLine/prebuilt-projection-budget",
            "gid://shopify/CartLine/builder",
        ));
        let input = append_cart_line(valid_eight_input(), &builder_line);
        let result = run_fixture(&input)?;

        assert_eq!(result.operations.len(), 2);
        assert_eq!(
            operation_cart_line_id(&result.operations[0]),
            "gid://shopify/CartLine/builder"
        );
        assert_eq!(
            operation_cart_line_id(&result.operations[1]),
            "gid://shopify/CartLine/prebuilt-projection-budget"
        );
        assert_eq!(operation_item_count(&result.operations[0]), 3);
        assert_eq!(operation_item_count(&result.operations[1]), 8);
        Ok(())
    }

    #[test]
    fn invalid_prebuilt_candidate_does_not_erase_shared_core_operations() -> Result<()> {
        let invalid_prebuilt =
            valid_eight_input().replace("\"checksum\": \"eeb56acf\"", "\"checksum\": \"00000000\"");
        let builder_line = only_cart_line(&standard_builder_input().replace(
            "gid://shopify/CartLine/prebuilt-projection-budget",
            "gid://shopify/CartLine/builder",
        ));
        let result = run_fixture(&append_cart_line(&invalid_prebuilt, &builder_line))?;

        assert_eq!(result.operations.len(), 1);
        assert_eq!(
            operation_cart_line_id(&result.operations[0]),
            "gid://shopify/CartLine/builder"
        );
        Ok(())
    }

    #[test]
    fn typed_invalid_prebuilt_candidates_do_not_erase_shared_core_operations() -> Result<()> {
        let missing_parent_title = valid_eight_input().replacen(
            ",\n                  \"title\": \"AS2014B2-MK-2011-4005P\"\n",
            "\n",
            1,
        );
        let string_sequence =
            valid_eight_input().replacen("\"sequence\": 1", "\"sequence\": \"1\"", 1);
        let builder_line = only_cart_line(&standard_builder_input().replace(
            "gid://shopify/CartLine/prebuilt-projection-budget",
            "gid://shopify/CartLine/builder-survivor",
        ));

        for malformed_prebuilt in [missing_parent_title, string_sequence] {
            let result = run_fixture(&append_cart_line(&malformed_prebuilt, &builder_line))?;

            assert_eq!(result.operations.len(), 1);
            assert_eq!(
                operation_cart_line_id(&result.operations[0]),
                "gid://shopify/CartLine/builder-survivor"
            );
            assert_eq!(operation_item_count(&result.operations[0]), 3);
        }
        Ok(())
    }

    #[test]
    fn cross_path_same_cart_line_id_keeps_shared_core_and_suppresses_prebuilt() -> Result<()> {
        let builder_line = only_cart_line(&standard_builder_input());
        let result = run_fixture(&append_cart_line(valid_eight_input(), &builder_line))?;

        assert_eq!(result.operations.len(), 1);
        assert_eq!(
            operation_cart_line_id(&result.operations[0]),
            "gid://shopify/CartLine/prebuilt-projection-budget"
        );
        assert_eq!(operation_item_count(&result.operations[0]), 3);
        Ok(())
    }

    #[test]
    fn shared_core_supports_multiple_distinct_builder_lines() -> Result<()> {
        let standard = standard_builder_input().replace(
            "gid://shopify/CartLine/prebuilt-projection-budget",
            "gid://shopify/CartLine/standard",
        );
        let advanced_line = only_cart_line(
            &advanced_builder_input()
                .replace(
                    "gid://shopify/CartLine/prebuilt-projection-budget",
                    "gid://shopify/CartLine/advanced",
                )
                .replace(
                    "11111111-1111-4111-8111-111111111111",
                    "22222222-2222-4222-8222-222222222222",
                ),
        );
        let result = run_fixture(&append_cart_line(&standard, &advanced_line))?;

        assert_eq!(result.operations.len(), 2);
        assert_eq!(operation_item_count(&result.operations[0]), 3);
        assert_eq!(operation_item_count(&result.operations[1]), 4);
        Ok(())
    }

    #[test]
    fn duplicate_prebuilt_bundle_ids_suppress_prebuilt_but_keep_shared_core() -> Result<()> {
        let second_prebuilt = only_cart_line(&valid_eight_input().replace(
            "gid://shopify/CartLine/prebuilt-projection-budget",
            "gid://shopify/CartLine/prebuilt-2",
        ));
        let builder_line = only_cart_line(&standard_builder_input().replace(
            "gid://shopify/CartLine/prebuilt-projection-budget",
            "gid://shopify/CartLine/builder",
        ));
        let input = append_cart_line(
            &append_cart_line(valid_eight_input(), &second_prebuilt),
            &builder_line,
        );
        let result = run_fixture(&input)?;

        assert_eq!(result.operations.len(), 1);
        assert_eq!(
            operation_cart_line_id(&result.operations[0]),
            "gid://shopify/CartLine/builder"
        );
        Ok(())
    }

    #[test]
    fn duplicate_prebuilt_cart_line_ids_suppress_prebuilt_but_keep_shared_core() -> Result<()> {
        let second_prebuilt = only_cart_line(&valid_eight_input().replace(
            "11111111-1111-4111-8111-111111111111",
            "22222222-2222-4222-8222-222222222222",
        ));
        let builder_line = only_cart_line(&standard_builder_input().replace(
            "gid://shopify/CartLine/prebuilt-projection-budget",
            "gid://shopify/CartLine/builder",
        ));
        let input = append_cart_line(
            &append_cart_line(valid_eight_input(), &second_prebuilt),
            &builder_line,
        );
        let result = run_fixture(&input)?;

        assert_eq!(result.operations.len(), 1);
        assert_eq!(
            operation_cart_line_id(&result.operations[0]),
            "gid://shopify/CartLine/builder"
        );
        Ok(())
    }

    #[test]
    fn projection_parent_product_mismatch_fails_closed() -> Result<()> {
        let input = valid_eight_input().replace(
            "\"product_gid\": \"gid://shopify/Product/10638456357142\"",
            "\"product_gid\": \"gid://shopify/Product/99999999999999\"",
        );

        assert_no_operations(&input)
    }

    #[test]
    fn projection_parent_variant_mismatch_fails_closed() -> Result<()> {
        assert_no_operations(include_str!("../tests/fixtures/invalid-parent.json"))
    }

    #[test]
    fn missing_bundle_metadata_fails_closed() -> Result<()> {
        let input = valid_eight_input().replace("\"bundleId\"", "\"missingBundleId\"");

        assert_no_operations(&input)
    }

    #[test]
    fn invalid_component_decimal_fails_closed() -> Result<()> {
        let input = valid_eight_input().replacen(
            "\"fixed_price_per_unit\": \"10.00\"",
            "\"fixed_price_per_unit\": \"invalid\"",
            1,
        );

        assert_no_operations(&input)
    }

    #[test]
    fn component_price_total_mismatch_fails_closed() -> Result<()> {
        let input = valid_eight_input().replace("\"amount\": \"80.00\"", "\"amount\": \"81.00\"");

        assert_no_operations(&input)
    }

    #[test]
    fn empty_components_fail_closed() -> Result<()> {
        let input = replace_components(valid_eight_input(), "[]")
            .replace("\"amount\": \"80.00\"", "\"amount\": \"0.00\"");

        assert_no_operations(&input)
    }

    #[test]
    fn duplicate_component_sequence_fails_closed() -> Result<()> {
        let input = valid_eight_input().replace("\"sequence\": 2", "\"sequence\": 1");

        assert_no_operations(&input)
    }

    #[test]
    fn duplicate_component_variant_fails_closed() -> Result<()> {
        let input = valid_eight_input().replace(
            "gid://shopify/ProductVariant/20000000000002",
            "gid://shopify/ProductVariant/20000000000001",
        );

        assert_no_operations(&input)
    }

    #[test]
    fn duplicate_bundle_instance_across_lines_fails_closed() -> Result<()> {
        let input = duplicate_only_cart_line(valid_eight_input());

        assert_no_operations(&input)
    }

    #[test]
    fn bundle_metadata_parent_product_mismatch_fails_closed() -> Result<()> {
        let input = valid_eight_input().replacen(
            "gid://shopify/Product/10638456357142",
            "gid://shopify/Product/99999999999999",
            1,
        );

        assert_no_operations(&input)
    }

    #[test]
    fn bundle_metadata_parent_variant_mismatch_fails_closed() -> Result<()> {
        let input = valid_eight_input().replacen(
            "gid://shopify/ProductVariant/51592577089814",
            "gid://shopify/ProductVariant/99999999999999",
            1,
        );

        assert_no_operations(&input)
    }

    #[test]
    fn invalid_bundle_metadata_schema_version_fails_closed() -> Result<()> {
        let input = valid_eight_input().replace(
            "\"bundleSchemaVersion\": {\n          \"value\": \"1\"",
            "\"bundleSchemaVersion\": {\n          \"value\": \"2\"",
        );

        assert_no_operations(&input)
    }

    #[test]
    fn invalid_bundle_instance_id_fails_closed() -> Result<()> {
        let input = valid_eight_input().replace(
            "11111111-1111-4111-8111-111111111111",
            "not-a-bundle-instance-id",
        );

        assert_no_operations(&input)
    }

    #[test]
    fn invalid_component_shape_fails_closed() -> Result<()> {
        let input = valid_eight_input().replacen("\"group\": \"group_1\"", "\"group\": \"\"", 1);

        assert_no_operations(&input)
    }

    fn valid_eight_input() -> &'static str {
        include_str!("../tests/fixtures/valid-8.json")
    }

    fn standard_builder_input() -> String {
        builder_input(EFI_FUSION_LITE, FUEL_TEST, IGNITION_BLACK_JACK, None)
    }

    fn advanced_builder_input() -> String {
        builder_input(
            EFI_KILLSHOT_2_PRO,
            FUEL_TEST_2,
            IGNITION_HIGH_ROLLER,
            Some(DISPLAY_8_HD),
        )
    }

    fn builder_input(efi: &str, fuel: &str, ignition: &str, display: Option<&str>) -> String {
        let mut input = valid_eight_input()
            .replace(
                "\"prebuiltExpandProjectionMetafield\"",
                "\"ignoredPrebuiltExpandProjectionMetafield\"",
            )
            .replace(
                "gid://shopify/Product/10638456357142",
                "gid://shopify/Product/10600519598358",
            )
            .replace(
                "gid://shopify/ProductVariant/51592577089814",
                MASTER_KIT_VARIANT_ID,
            );
        input = set_builder_attribute(input, "builderEfiVariantId", efi);
        input = set_builder_attribute(input, "builderFuelVariantId", fuel);
        input = set_builder_attribute(input, "builderIgnitionVariantId", ignition);
        if let Some(display) = display {
            input = set_builder_attribute(input, "builderDisplayVariantId", display);
        }
        input
    }

    fn set_builder_attribute(input: String, field: &str, value: &str) -> String {
        input.replace(
            &format!("\"{field}\": null"),
            &format!("\"{field}\": {{ \"value\": \"{value}\" }}"),
        )
    }

    fn run_fixture(input: &str) -> Result<FunctionRunResult> {
        run_function_with_input(run, input)
    }

    fn only_expand(result: &FunctionRunResult) -> &schema::ExpandOperation {
        assert_eq!(result.operations.len(), 1);
        let schema::CartOperation::Expand(expand) = &result.operations[0] else {
            panic!("expected expand operation");
        };
        expand
    }

    fn expanded_variant_ids(expand: &schema::ExpandOperation) -> Vec<&str> {
        expand
            .expanded_cart_items
            .iter()
            .map(|item| item.merchandise_id.as_str())
            .collect()
    }

    fn expanded_prices(expand: &schema::ExpandOperation) -> Vec<f64> {
        expand
            .expanded_cart_items
            .iter()
            .map(|item| {
                let adjustment = &item.price.as_ref().expect("fixed price").adjustment;
                let schema::ExpandedItemPriceAdjustmentValue::FixedPricePerUnit(fixed) = adjustment;
                fixed.amount.as_f64()
            })
            .collect()
    }

    fn attribute_value<'a>(item: &'a schema::ExpandedItem, key: &str) -> Option<&'a str> {
        item.attributes
            .as_ref()?
            .iter()
            .find(|attribute| attribute.key == key)
            .map(|attribute| attribute.value.as_str())
    }

    fn operation_cart_line_id(operation: &schema::CartOperation) -> &str {
        let schema::CartOperation::Expand(expand) = operation else {
            panic!("expected expand operation");
        };
        &expand.cart_line_id
    }

    fn operation_item_count(operation: &schema::CartOperation) -> usize {
        let schema::CartOperation::Expand(expand) = operation else {
            panic!("expected expand operation");
        };
        expand.expanded_cart_items.len()
    }

    fn only_cart_line(input: &str) -> String {
        let lines_field = input.find("\"lines\": [").expect("lines field");
        let start = input[lines_field..].find('{').expect("cart line") + lines_field;
        let end = input.rfind("\n    ]").expect("lines closing bracket");
        input[start..end].to_string()
    }

    fn append_cart_line(input: &str, line: &str) -> String {
        let end = input.rfind("\n    ]").expect("lines closing bracket");
        format!("{},\n      {}{}", &input[..end], line, &input[end..])
    }

    fn assert_no_operations(input: &str) -> Result<()> {
        let result = run_function_with_input(run, input)?;
        assert!(result.operations.is_empty());
        Ok(())
    }

    fn replace_components(input: &str, replacement: &str) -> String {
        let field = input.find("\"components\": [").expect("components field");
        let start = field + "\"components\": ".len();
        let checksum = input.find("\"checksum\":").expect("checksum field");
        let end = input[..checksum]
            .rfind(']')
            .expect("components closing bracket")
            + 1;
        format!("{}{}{}", &input[..start], replacement, &input[end..])
    }

    fn duplicate_only_cart_line(input: &str) -> String {
        let lines_field = input.find("\"lines\": [").expect("lines field");
        let start = input[lines_field..].find('{').expect("cart line") + lines_field;
        let end = input.rfind("\n    ]").expect("lines closing bracket");
        let line = &input[start..end];
        format!("{}{},{}{}", &input[..start], line, line, &input[end..])
    }

    fn attribute_pair(attribute: &schema::AttributeOutput) -> (&str, &str) {
        (&attribute.key, &attribute.value)
    }
}
