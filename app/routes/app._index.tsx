import { Page, Text, Card, Button, BlockStack } from "@shopify/polaris";

export default function Index() {
  return (
    <Page title="ACES Bundle Administration">
      <BlockStack gap="400">
        <Card>
          <BlockStack gap="300">
            <Text as="h1" variant="headingLg">Bundle configuration</Text>
            <Text as="p" tone="subdued">
              Manage bundle definitions and draft revisions. Publishing and Cart Transform registration are intentionally not available from this app surface.
            </Text>
            <Button url="/app/bundle-admin" variant="primary">Open Bundle Admin</Button>
          </BlockStack>
        </Card>
      </BlockStack>
    </Page>
  );
}
