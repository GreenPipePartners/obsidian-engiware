"""Import the existing Engibook SVG into native ia.shapes.svg properties.

All SVG path data, group transforms, labels and paints are retained. The native
view crops to the operator face and binds only its existing DC OK lamp paints.
"""
import argparse
import hashlib
import json
from pathlib import Path
import re
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
EXAMPLE = ROOT / 'examples/1606-xle240e-dc-ok'


def color_binding(healthy, unhealthy):
    return {'binding': {'type': 'property', 'config': {'path': 'view.custom.dcOk'},
                        'transforms': [{'type': 'map', 'inputType': 'scalar', 'outputType': 'color',
                                        'fallback': '#94a3b8', 'mappings': [
                                            {'input': True, 'output': healthy},
                                            {'input': False, 'output': unhealthy}]}]}}


def import_svg(source):
    root = ET.fromstring(source)
    counts = {'paths': 0, 'labels': 0}
    lamp = {}
    def convert(element, path):
        kind = element.tag.split('}')[-1]
        # Excalidraw emits inert empty masks and font containers; omit only those.
        if kind in ('metadata', 'defs', 'mask') and not element.attrib and not ''.join(element.itertext()).strip():
            return None
        if kind not in ('g', 'path', 'rect', 'text'):
            raise ValueError(f'Unsupported source SVG element: {kind}')
        item = {'type': 'group' if kind == 'g' else kind}
        for key, value in element.attrib.items():
            if key == 'fill': item.setdefault('fill', {})['paint'] = value
            elif key == 'stroke': item.setdefault('stroke', {})['paint'] = value
            elif key.startswith('fill-'): item.setdefault('fill', {})[key[5:]] = value
            elif key.startswith('stroke-'): item.setdefault('stroke', {})[key[7:]] = value
            elif key == 'style':
                item['style'] = {re.sub(r'-([a-z])', lambda m: m[1].upper(), k.strip()): v.strip()
                                 for k, v in (field.split(':', 1) for field in value.split(';') if field.strip())}
            else: item[re.sub(r'-([a-z])', lambda m: m[1].upper(), key)] = value
        if kind == 'text':
            item['text'] = element.text or ''
            counts['labels'] += 1
        if kind == 'path': counts['paths'] += 1
        if element.get('fill') == '#9bdc89':
            assert 'fill' not in lamp, 'Ambiguous DC OK fill'
            item['name'] = 'dc-ok-lamp-fill'
            lamp['fill'] = f'{path}.fill.paint'
        if element.get('stroke') == '#86bd7a':
            assert 'stroke' not in lamp, 'Ambiguous DC OK outline'
            item['name'] = 'dc-ok-lamp-outline'
            lamp['stroke'] = f'{path}.stroke.paint'
        children = []
        for child in element:
            result = convert(child, f'{path}.elements[{len(children)}]')
            if result is not None: children.append(result)
        if children: item['elements'] = children
        return item
    elements = []
    for child in root:
        item = convert(child, f'props.elements[{len(elements)}]')
        if item is not None: elements.append(item)
    assert set(lamp) == {'fill', 'stroke'}, 'Original DC OK lamp is missing'
    assert counts == {'paths': 510, 'labels': 32}, 'Source drawing changed; review its lamp selection and geometry'
    return elements, lamp, counts


def build(source_path=EXAMPLE / '1606-XLE240E-panel.svg'):
    source = source_path.read_bytes()
    elements, lamp, counts = import_svg(source)
    view = {
        'custom': {'dcOk': True}, 'params': {'tagPath': '[default]Engispark/PS1_DC_OK'},
        'propConfig': {
            'params.tagPath': {'paramDirection': 'input', 'persistent': True},
            'custom.dcOk': {'binding': {'type': 'tag', 'config': {
                'mode': 'indirect', 'bidirectional': True, 'fallbackDelay': 2.5,
                'references': {'tagPath': '{view.params.tagPath}'}, 'tagPath': '{tagPath}'}}}},
        'props': {'defaultSize': {'width': 560, 'height': 560}},
        'root': {'type': 'ia.container.flex', 'meta': {'name': 'root'}, 'props': {
            'direction': 'row', 'wrap': 'wrap', 'alignItems': 'center',
            'style': {'backgroundColor': '#ffffff', 'color': '#152330', 'padding': '20px', 'gap': '16px', 'borderRadius': '8px'}},
            'children': [
                {'type': 'ia.shapes.svg', 'meta': {'name': 'ComponentDrawing'},
                 'position': {'basis': '200px', 'grow': 1, 'shrink': 0},
                 'props': {'viewBox': '166 194 184 528', 'preserveAspectRatio': 'xMidYMid',
                           'elements': elements, 'style': {'height': '520px'}},
                 'propConfig': {lamp['fill']: color_binding('#9bdc89', '#ef4444'),
                                lamp['stroke']: color_binding('#86bd7a', '#b91c1c')}},
                {'type': 'ia.container.flex', 'meta': {'name': 'Controls'},
                 'position': {'basis': '230px', 'grow': 1},
                 'props': {'direction': 'column', 'style': {'gap': '16px'}},
                 'children': [
                     {'type': 'ia.display.label', 'meta': {'name': 'Catalog'},
                      'props': {'text': '1606-XLE240E', 'style': {'fontSize': '24px', 'fontWeight': '700'}}},
                     {'type': 'ia.display.label', 'meta': {'name': 'Description'},
                      'props': {'text': 'Allen-Bradley · 24 V DC / 10 A', 'style': {'color': '#52616d', 'fontSize': '14px'}}},
                     {'type': 'ia.input.checkbox', 'meta': {'name': 'DcOkToggle'},
                      'props': {'selected': True, 'enabled': True, 'text': 'DC OK signal', 'style': {'fontSize': '16px'}},
                      'propConfig': {'props.selected': {'binding': {'type': 'property', 'config': {'path': 'view.custom.dcOk', 'bidirectional': True}}}}},
                     {'type': 'ia.display.label', 'meta': {'name': 'DcOkText'},
                      'props': {'text': 'DC OK', 'style': {'fontSize': '18px', 'fontWeight': '700'}},
                      'propConfig': {'props.text': {'binding': {'type': 'property', 'config': {'path': 'view.custom.dcOk'},
                          'transforms': [{'type': 'map', 'inputType': 'scalar', 'outputType': 'scalar', 'fallback': 'DC status unavailable',
                                          'mappings': [{'input': True, 'output': 'DC OK'}, {'input': False, 'output': 'DC NOT OK'}]}]}}}},
                     {'type': 'ia.display.label', 'meta': {'name': 'TagPath'},
                      'props': {'text': '', 'style': {'fontSize': '11px', 'color': '#52616d', 'overflowWrap': 'anywhere'}},
                      'propConfig': {'props.text': {'binding': {'type': 'property', 'config': {'path': 'view.params.tagPath'}}}}}
                 ]}
            ]}
    }
    provenance = {
        'sourceSvg': '1606-XLE240E-panel.svg', 'sourceSvgSha256': hashlib.sha256(source).hexdigest(),
        'sourceDrawing': '2d_scaled_component/1606-XLE240E-panel.excalidraw.md',
        'sourceElementId': '861f0e79', 'sourceElementName': 'panel-dc-ok-indicator',
        'nativeComponent': 'ia.shapes.svg', 'bindingTargets': lamp,
        'sourceViewBox': '0 0 1220 880', 'operatorFaceViewBox': '166 194 184 528',
        'retainedArtwork': counts,
        'schemaReference': 'https://forum.inductiveautomation.com/t/107192/2',
    }
    for name, data in [('view.json', view), ('artwork-provenance.json', provenance)]:
        (EXAMPLE / name).write_text(json.dumps(data, indent=2, ensure_ascii=False) + '\n')
    return provenance


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--svg', type=Path, default=EXAMPLE / '1606-XLE240E-panel.svg')
    print(json.dumps(build(parser.parse_args().svg), indent=2))
