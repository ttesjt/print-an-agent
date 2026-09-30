import {
  Checkbox,
  Cluster,
  Fieldset,
  FieldsetLegend,
  FormField,
  Grid,
  Label,
  Panel,
  PanelBody,
  PanelHeader,
  Select,
  Stack,
  Switch,
  Textarea,
  TextInput,
} from '@ta-agent/ui-react';

import { GallerySection } from './gallery-section.js';

export function FormsGallery() {
  return (
    <GallerySection
      description="Native controls retain browser state semantics while FormField provides explicit accessible relationships."
      id="forms"
      title="Forms"
    >
      <Grid columns="two">
        <Panel>
          <PanelHeader>
            <h3>Field relationships</h3>
          </PanelHeader>
          <PanelBody>
            <Stack space="medium">
              <FormField description="Visible in the Agent catalog." label="Agent name" required>
                {(controlProps) => (
                  <TextInput {...controlProps} defaultValue="Research Agent" name="agentName" />
                )}
              </FormField>
              <FormField
                description="Describe the Agent's primary responsibility."
                label="Instructions"
              >
                {(controlProps) => (
                  <Textarea {...controlProps} defaultValue="Help analyze research material." />
                )}
              </FormField>
              <FormField label="Runtime profile">
                {(controlProps) => (
                  <Select {...controlProps} defaultValue="local">
                    <option value="local">Local</option>
                    <option value="hosted">Hosted</option>
                  </Select>
                )}
              </FormField>
            </Stack>
          </PanelBody>
        </Panel>

        <Panel>
          <PanelHeader>
            <h3>Validation and availability</h3>
          </PanelHeader>
          <PanelBody>
            <Stack space="medium">
              <FormField error="A stable identifier is required." label="Agent ID" required>
                {(controlProps) => <TextInput {...controlProps} value="" readOnly />}
              </FormField>
              <FormField description="This value is managed by the host." label="Namespace">
                {(controlProps) => <TextInput {...controlProps} readOnly value="default" />}
              </FormField>
              <FormField disabled label="Unavailable provider">
                {(controlProps) => (
                  <Select {...controlProps} defaultValue="unavailable">
                    <option value="unavailable">Not installed</option>
                  </Select>
                )}
              </FormField>
            </Stack>
          </PanelBody>
        </Panel>
      </Grid>

      <Fieldset>
        <FieldsetLegend>Interaction capabilities</FieldsetLegend>
        <Cluster space="large">
          <Label className="ta-ui-gallery-control-label">
            <Checkbox defaultChecked /> Tool calling
          </Label>
          <Label className="ta-ui-gallery-control-label">
            <Switch defaultChecked /> Reasoning presentation
          </Label>
          <Label className="ta-ui-gallery-control-label" data-gallery-direction="rtl" dir="rtl">
            <Switch defaultChecked /> RTL switch
          </Label>
          <Label className="ta-ui-gallery-control-label">
            <Checkbox disabled /> Disabled capability
          </Label>
        </Cluster>
      </Fieldset>
    </GallerySection>
  );
}
