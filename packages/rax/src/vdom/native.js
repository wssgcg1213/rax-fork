import Host from './host';
import Ref from './ref';
import instantiateComponent from './instantiateComponent';
import shouldUpdateComponent from './shouldUpdateComponent';
import getElementKeyName from './getElementKeyName';
import Instance from './instance';
import BaseComponent from './base';
import toArray from './toArray';
import { isFunction, isArray, isNull } from '../types';
import assign from '../assign';
import { INSTANCE, INTERNAL, NATIVE_NODE } from '../constant';


const STYLE = 'style';
const CHILDREN = 'children';
const TREE = 'tree';
const EVENT_PREFIX_REGEXP = /^on[A-Z]/;

/**
 * Native Component
 */
export default class NativeComponent extends BaseComponent {
  __mountComponent(parent, parentInstance, context, nativeNodeMounter) {
    this.__initComponent(parent, parentInstance, context);

    const currentElement = this.__currentElement;
    const props = currentElement.props;
    const type = currentElement.type;
    const children = props.children;
    const appendType = props.append || TREE; // Default is tree

    // Clone a copy for style diff
    this.__prevStyleCopy = assign({}, props.style);

    let instance = {
      type,
      props,
    };
    instance[INTERNAL] = this;

    this[INSTANCE] = instance;

    let mountChildren = () => {
      if (children != null) {
        this.__mountChildren(children, context);
      }
    };

    if (appendType === TREE) {
      // Should after process children when mount by tree mode
      mountChildren();
      this.__mountNativeNode(nativeNodeMounter);
    } else {
      // Should before process children when mount by node mode
      this.__mountNativeNode(nativeNodeMounter);
      mountChildren();
    }

    // Ref acttach
    if (currentElement && currentElement.ref) {
      Ref.attach(currentElement._owner, currentElement.ref, this);
    }

    if (process.env.NODE_ENV !== 'production') {
      Host.reconciler.mountComponent(this);
    }

    return instance;
  }

  __mountChildren(children, context) {
    children = toArray(children);

    const nativeNode = this.__getNativeNode();
    return this.__mountChildrenImpl(nativeNode, children, context);
  }

  __mountChildrenImpl(parent, children, context, nativeNodeMounter) {
    let renderedChildren = this._renderedChildren = {};

    const renderedChildrenImage = [];
    for (let i = 0, l = children.length; i < l; i++) {
      const element = children[i];
      const renderedChild = instantiateComponent(element);
      const name = getElementKeyName(renderedChildren, element, i);
      renderedChildren[name] = renderedChild;
      renderedChild.__mountIndex = i;
      // Mount children
      const mountImage = renderedChild.__mountComponent(
        parent,
        this[INSTANCE],
        context,
        nativeNodeMounter
      );
      renderedChildrenImage.push(mountImage);
    }

    return renderedChildrenImage;
  }

  __unmountChildren(shouldNotRemoveChild) {
    let renderedChildren = this._renderedChildren;

    if (renderedChildren) {
      for (let name in renderedChildren) {
        let renderedChild = renderedChildren[name];
        renderedChild.unmountComponent(shouldNotRemoveChild);
      }
      this._renderedChildren = null;
    }
  }

  unmountComponent(shouldNotRemoveChild) {
    if (this[NATIVE_NODE]) {
      let ref = this.__currentElement.ref;
      if (ref) {
        Ref.detach(this.__currentElement._owner, ref, this);
      }

      Instance.remove(this[NATIVE_NODE]);

      if (!shouldNotRemoveChild) {
        Host.driver.removeChild(this[NATIVE_NODE], this._parent);

        // If the parent node has been removed, child node don't need to be removed
        shouldNotRemoveChild = true;
      }
    }

    this.__unmountChildren(shouldNotRemoveChild);

    this.__prevStyleCopy = null;
    this.__destoryComponent();
  }

  __updateComponent(prevElement, nextElement, prevContext, nextContext) {
    // Replace current element
    this.__currentElement = nextElement;

    Ref.update(prevElement, nextElement, this);

    let prevProps = prevElement.props;
    let nextProps = nextElement.props;

    this.__updateProperties(prevProps, nextProps);

    // If the prevElement has no child, mount children directly
    if (prevProps.children == null ||
      isArray(prevProps.children) && prevProps.children.length === 0) {
      this.__mountChildren(nextProps.children, nextContext);
    } else {
      this.__updateChildren(nextProps.children, nextContext);
    }

    if (process.env.NODE_ENV !== 'production') {
      Host.reconciler.receiveComponent(this);
    }
  }

  __updateProperties(prevProps, nextProps) {
    let propKey;
    let styleName;
    let styleUpdates;
    const driver = Host.driver;
    const nativeNode = this.__getNativeNode();

    for (propKey in prevProps) {
      // Continue children and null value prop or nextProps has some propKey that do noting
      if (
        propKey === CHILDREN ||
        prevProps[propKey] == null ||
        // Use hasOwnProperty here for avoid propKey name is some with method name in object proptotype
        nextProps.hasOwnProperty(propKey)
      ) {
        continue;
      }

      if (propKey === STYLE) {
        // Remove all style
        let lastStyle = this.__prevStyleCopy;
        for (styleName in lastStyle) {
          styleUpdates = styleUpdates || {};
          styleUpdates[styleName] = '';
        }
        this.__prevStyleCopy = null;
      } else if (EVENT_PREFIX_REGEXP.test(propKey)) {
        // Remove event
        const eventListener = prevProps[propKey];

        if (isFunction(eventListener)) {
          driver.removeEventListener(
            nativeNode,
            propKey.slice(2).toLowerCase(),
            eventListener
          );
        }
      } else {
        // Remove attribute
        driver.removeAttribute(
          nativeNode,
          propKey,
          prevProps[propKey]
        );
      }
    }

    for (propKey in nextProps) {
      let nextProp = nextProps[propKey];
      let prevProp = propKey === STYLE ? this.__prevStyleCopy :
        prevProps != null ? prevProps[propKey] : undefined;

      // Continue children or prevProp equal nextProp
      if (
        propKey === CHILDREN ||
        prevProp === nextProp ||
        nextProp == null && prevProp == null
      ) {
        continue;
      }

      // Update style
      if (propKey === STYLE) {
        if (nextProp) {
          // Clone property
          nextProp = this.__prevStyleCopy = assign({}, nextProp);
        } else {
          this.__prevStyleCopy = null;
        }

        if (prevProp != null) {
          // Unset styles on `prevProp` but not on `nextProp`.
          for (styleName in prevProp) {
            if (!nextProp || !nextProp[styleName] && nextProp[styleName] !== 0) {
              styleUpdates = styleUpdates || {};
              styleUpdates[styleName] = '';
            }
          }
          // Update styles that changed since `prevProp`.
          for (styleName in nextProp) {
            if (prevProp[styleName] !== nextProp[styleName]) {
              styleUpdates = styleUpdates || {};
              styleUpdates[styleName] = nextProp[styleName];
            }
          }
        } else {
          // Assign next prop when prev style is null
          styleUpdates = nextProp;
        }
      } else if (EVENT_PREFIX_REGEXP.test(propKey)) {
        // Update event binding
        let eventName = propKey.slice(2).toLowerCase();

        if (isFunction(prevProp)) {
          driver.removeEventListener(nativeNode, eventName, prevProp, nextProps);
        }

        if (isFunction(nextProp)) {
          driver.addEventListener(nativeNode, eventName, nextProp, nextProps);
        }
      } else {
        // Update other property
        if (nextProp != null) {
          driver.setAttribute(
            nativeNode,
            propKey,
            nextProp
          );
        } else {
          driver.removeAttribute(
            nativeNode,
            propKey,
            prevProps[propKey]
          );
        }

        if (process.env.NODE_ENV !== 'production') {
          Host.measurer && Host.measurer.recordOperation({
            instanceID: this._mountID,
            type: 'update attribute',
            payload: {
              [propKey]: nextProp
            }
          });
        }
      }
    }

    if (styleUpdates) {
      if (process.env.NODE_ENV !== 'production') {
        Host.measurer && Host.measurer.recordOperation({
          instanceID: this._mountID,
          type: 'update style',
          payload: styleUpdates
        });
      }

      driver.setStyle(nativeNode, styleUpdates);
    }
  }

  __updateChildren(nextChildrenElements, context) {
    // prev rendered children
    let prevChildren = this._renderedChildren;
    let driver = Host.driver;

    if (nextChildrenElements == null && prevChildren == null) {
      return;
    }

    let nextChildren = {};

    if (nextChildrenElements != null) {
      nextChildrenElements = toArray(nextChildrenElements);

      // Update next children elements
      for (let index = 0, length = nextChildrenElements.length; index < length; index++) {
        let nextElement = nextChildrenElements[index];
        let name = getElementKeyName(nextChildren, nextElement, index);
        let prevChild = prevChildren && prevChildren[name];
        let prevElement = prevChild && prevChild.__currentElement;
        let prevContext = prevChild && prevChild._context;

        // Try to update between the two of some name that has some element type,
        // and move child in next children loop if need
        if (prevChild != null && shouldUpdateComponent(prevElement, nextElement)) {
          if (prevElement !== nextElement || prevContext !== context) {
            // Pass the same context when updating chidren
            prevChild.__updateComponent(prevElement, nextElement, context,
              context);
          }

          nextChildren[name] = prevChild;
        } else {
          // Unmount the prevChild when some name with nextChild but different element type,
          // and move child node in next children loop
          if (prevChild) {
            prevChild.__unmount = true;
          }
          // The child must be instantiated before it's mounted.
          nextChildren[name] = instantiateComponent(nextElement);
        }
      }
    }

    let prevFirstChild;
    let prevFirstNativeNode;
    let shouldUnmountPrevFirstChild;

    // Directly remove all children from component, if nextChildren is empty (null, [], '').
    // `driver.removeChildren` is optional driver protocol.
    let shouldRemoveAllChildren = Boolean(
      driver.removeChildren
      && isNull(nextChildrenElements) || nextChildrenElements && !nextChildrenElements.length
    );

    // Unmount children that are no longer present.
    if (prevChildren != null) {
      for (let name in prevChildren) {
        let prevChild = prevChildren[name];
        let shouldUnmount = prevChild.__unmount || !nextChildren[name];

        // Store old first child ref for append node ahead and maybe delay remove it
        if (!prevFirstChild) {
          shouldUnmountPrevFirstChild = shouldUnmount;
          prevFirstChild = prevChild;
          prevFirstNativeNode = prevFirstChild.__getNativeNode();

          if (isArray(prevFirstNativeNode)) {
            prevFirstNativeNode = prevFirstNativeNode[0];
          }
        } else if (shouldUnmount) {
          prevChild.unmountComponent(shouldRemoveAllChildren);
        }
      }
    }

    if (nextChildren != null) {
      // `nextIndex` will increment for each child in `nextChildren`
      let nextIndex = 0;
      let lastPlacedNode = null;
      let nextNativeNode = [];

      function insertNodes(nativeNodes, parent) {
        // The nativeNodes maybe fragment, so convert to array type
        nativeNodes = toArray(nativeNodes);

        if (lastPlacedNode) {
          // Should reverse order when insert new child after lastPlacedNode:
          // [lastPlacedNode, *newChild1, *newChild2]
          for (let i = nativeNodes.length - 1; i >= 0; i--) {
            driver.insertAfter(nativeNodes[i], lastPlacedNode);
          }
        } else if (prevFirstNativeNode) {
          // [*newChild1, *newChild2, prevFirstNativeNode]
          for (let i = 0; i < nativeNodes.length; i++) {
            driver.insertBefore(nativeNodes[i], prevFirstNativeNode);
          }
        } else if (parent) {
          // [*newChild1, *newChild2]
          for (let i = 0; i < nativeNodes.length; i++) {
            driver.appendChild(nativeNodes[i], parent);
          }
        }
      }

      for (let name in nextChildren) {
        let nextChild = nextChildren[name];
        let prevChild = prevChildren && prevChildren[name];

        // Try to move the some key prevChild but current not at the some position
        if (prevChild === nextChild) {
          let prevChildNativeNode = prevChild.__getNativeNode();

          if (prevChild.__mountIndex !== nextIndex) {
            insertNodes(prevChildNativeNode);
          }
        } else {
          // Mount nextChild that in prevChildren there has no some name

          let parent = this.__getNativeNode();
          // Fragment extended native component, so if parent is fragment should get this._parent
          if (isArray(parent)) {
            parent = this._parent;
          }

          nextChild.__mountComponent(
            parent,
            this[INSTANCE],
            context,
            insertNodes // Insert nodes mounter
          );
        }

        // Update to the latest mount order
        nextChild.__mountIndex = nextIndex++;

        // Get the last child
        lastPlacedNode = nextChild.__getNativeNode();

        // Push to nextNativeNode
        if (isArray(lastPlacedNode)) {
          nextNativeNode = nextNativeNode.concat(lastPlacedNode);
          lastPlacedNode = lastPlacedNode[lastPlacedNode.length - 1];
        } else {
          nextNativeNode.push(lastPlacedNode);
        }
      }

      // Sync update native refs
      if (isArray(this[NATIVE_NODE])) {
        // Clear all and push the new array
        this[NATIVE_NODE].splice(0, this[NATIVE_NODE].length);
        for (let i = 0, l = nextNativeNode.length; i < l; i++) {
          this[NATIVE_NODE].push(nextNativeNode[i]);
        }
      }
    }

    if (shouldUnmountPrevFirstChild) {
      prevFirstChild.unmountComponent(shouldRemoveAllChildren);
    }

    if (shouldRemoveAllChildren) {
      driver.removeChildren(this[NATIVE_NODE]);
    }

    this._renderedChildren = nextChildren;
  }

  __createNativeNode() {
    const instance = this[INSTANCE];
    const nativeNode = Host.driver.createElement(instance.type, instance.props, this);
    Instance.set(nativeNode, instance);
    return nativeNode;
  }
}
